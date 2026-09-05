"""Render a Guitar Pro file to a stereo mix: DI sampler + amp sim for guitars, FluidSynth for the rest."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time

import numpy as np
import soundfile as sf

from . import bass, fluid, midi_events
from .drumkit import DrumKit
from .drums import KICK_NOTES, limiter, synth_kick
from .guitar import AmpChain, GuitarKit

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.environ.get("TABRENDER_ASSETS", os.path.join(os.path.dirname(HERE), "assets"))
SOUNDFONT = os.environ.get("TABRENDER_SOUNDFONT", os.path.join(ASSETS, "FluidR3_GM_mono.sf2"))
GP2MIDI = os.path.join(os.path.dirname(HERE), "gp2midi.mjs")

DIST_PROGRAMS = {29, 30, 31}  # overdriven, distortion, harmonics
CLEAN_GUITAR_PROGRAMS = {24, 25, 26, 27, 28}
BASS_PROGRAMS = set(range(32, 40))

CONFIG = {
    "metal": {"root": "sfz/UI_METAL-GTX/Programs/", "patch": "Individual Patchs/METAL-GTX_Full/"},
    "standard": {"root": "sfz/UI_Standard_Guitar/Programs/", "patch": "Individual Patchs/Standard_Guitar_KSOP/"},
    "amp_dist": "amps/nam/MesaDualRec_MW_RedModern_g6_SM57_fullrig.nam",
    "amp_clean": "amps/PrincetonAmp_Clean.json",
    "ir": "ir/proteus_default_ir.wav",
    "dist_input_gain": 1.0,
    "clean_input_gain": 0.6,
    "dist_pre_hpf": 120,  # tightening high-pass before the amp (Hz), 0 = off
    "dist_post_hpf": 70,  # post-cab low cut (Hz)
    "dist_post_lpf": 9000,  # post-cab fizz cut (Hz)
    "double_track": True,  # distortion tracks: two takes hard-panned L/R
    "double_width": 0.8,  # pan amount for the takes (0 = centre, 1 = hard)
    # mix levels (peak-normalised stems)
    "level_guitar": 0.42,
    "level_drums": 0.9,
    "level_kick": 1.0,  # sampled kick, own stem
    "level_kick_synth": 0.5,  # synthetic sub/click layered under every kick hit
    "drumkit": "drums/ALL.sfz",  # Salamander Drumkit (SFZ); falls back to FluidSynth if missing
    "drum_velocity_boost": 25,  # GP dynamics land around 79; push into the kit's hard-hit layers
    "level_bass": 0.4,
    "bass_program": 33,  # every bass track plays FluidR3 "Electric Bass (finger)": the pick preset has no sustain, notes stay detached
    "bass_drive": 3.0,  # split-band drive on the bass (see bass.py)
    "max_seconds": 0,  # >0: render only the first N seconds (previews)
    "level_other": 0.6,
}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, file=sys.stderr, flush=True)


def _kit(name: str) -> GuitarKit:
    c = CONFIG[name]
    root = os.path.join(ASSETS, c["root"])
    return GuitarKit(root, os.path.join(root, c["patch"]))


def _pan(mono: np.ndarray, balance: int) -> np.ndarray:
    """balance 0..16 (8 = centre), constant-power pan."""
    p = (balance - 8) / 8.0
    a = (p + 1) / 2 * np.pi / 2
    return np.stack([mono * np.cos(a), mono * np.sin(a)], axis=1)


def render(gp_path: str, out_mp3: str, config: dict | None = None) -> dict:
    cfg = {**CONFIG, **(config or {})}
    t0 = time.time()
    with tempfile.TemporaryDirectory() as td:
        midi_path = os.path.join(td, "score.mid")
        meta_path = os.path.join(td, "score.json")
        subprocess.run(["node", GP2MIDI, gp_path, midi_path, meta_path], check=True, stdout=subprocess.DEVNULL)
        with open(meta_path) as fh:
            meta = json.load(fh)
        channels = midi_events.parse(midi_path)
        if cfg.get("max_seconds"):  # quick previews while tuning: render only the first N seconds
            for ch in channels.values():
                ch.notes = [n for n in ch.notes if n.start < cfg["max_seconds"]]
        length = max((n.end for ch in channels.values() for n in ch.notes), default=1.0) + 3.0
        n_samples = int(length * SR)
        mix = np.zeros((n_samples, 2), dtype=np.float32)
        groups: dict[str, set[int]] = {"drums": set(), "bass": set(), "other": set()}
        group_names: dict[str, list[str]] = {"drums": [], "bass": [], "other": []}
        kits: dict[str, GuitarKit] = {}
        chains: dict[str, AmpChain] = {}
        stem_dir = os.environ.get("TABRENDER_STEM_DIR")  # debugging: dump every stem as it goes into the mix

        def dump_stem(name: str, stem: np.ndarray) -> None:
            if stem_dir:
                os.makedirs(stem_dir, exist_ok=True)
                sf.write(os.path.join(stem_dir, f"{name}.wav"), stem, SR)

        for t in meta["tracks"]:
            prog, chans = t["program"], {t["primaryChannel"], t["secondaryChannel"]}
            vol = t["volume"] / 16.0
            is_perc = bool(t.get("isPercussion")) or t["primaryChannel"] == 9
            if prog == 127 and not is_perc:
                log(f"track {t['index']} '{t['name']}': program 127 (GP percussion sound exported as Gunshot), muted")
                continue
            is_guitar = (not is_perc) and (prog in DIST_PROGRAMS or prog in CLEAN_GUITAR_PROGRAMS)
            if not is_guitar:
                g = "drums" if is_perc else "bass" if prog in BASS_PROGRAMS else "other"
                groups[g] |= chans
                group_names[g].append(t["name"])
                continue
            dist = prog in DIST_PROGRAMS
            kit_name = "metal" if dist else "standard"
            kits.setdefault(kit_name, _kit(kit_name))
            chain_key = "dist" if dist else "clean"
            if chain_key not in chains:
                chains[chain_key] = AmpChain(
                    os.path.join(ASSETS, cfg["amp_dist" if dist else "amp_clean"]),
                    os.path.join(ASSETS, cfg["ir"]),
                    SR,
                    input_gain=cfg["dist_input_gain" if dist else "clean_input_gain"],
                    pre_hpf=cfg["dist_pre_hpf"] if dist else 0,
                    post_hpf=cfg["dist_post_hpf"] if dist else 0,
                    post_lpf=cfg["dist_post_lpf"] if dist else 0,
                )
            takes = 2 if (dist and cfg["double_track"]) else 1
            n_notes = sum(len(channels[c].notes) for c in chans if c in channels)
            log(f"track {t['index']} '{t['name']}' prog {prog}: {n_notes} notes -> {chain_key} chain, {takes} take(s)")
            for take in range(takes):
                di = np.zeros(n_samples, dtype=np.float32)
                for c in chans:
                    ch = channels.get(c)
                    if ch and ch.notes:
                        part = kits[kit_name].render(ch, meta["articulations"], t["index"], SR, length, take=take)
                        di[: len(part)] += part[:n_samples]
                if not np.any(di):
                    continue
                wet = chains[chain_key].process(di)
                if takes == 2:
                    # spread the two takes around the track's own balance
                    w = cfg["double_width"] * 8
                    balance = t["balance"] + (-w if take == 0 else w)
                    part = _pan(wet * cfg["level_guitar"] * vol, min(16, max(0, balance)))
                else:
                    part = _pan(wet * cfg["level_guitar"] * vol, t["balance"])
                dump_stem(f"guitar{t['index']}_take{take}", part)
                mix += part

        def add_stem(stem: np.ndarray, level: float, name: str = "stem") -> None:
            n = min(len(stem), n_samples)
            peak = float(np.abs(stem).max()) + 1e-9
            part = (stem[:n] / peak * level)[:, None] if stem.ndim == 1 else stem[:n] / peak * level
            dump_stem(name, part)
            mix[:n] += part

        for g, chans in groups.items():
            if not chans:
                continue
            log(f"fluidsynth {g}: {group_names[g]} channels {sorted(chans)}")
            if g == "drums":
                kit_path = os.path.join(ASSETS, cfg["drumkit"])
                if os.path.exists(kit_path):
                    dchans = [channels[c] for c in chans if c in channels]
                    for dch in dchans:
                        for n in dch.notes:
                            n.velocity = min(127, n.velocity + cfg["drum_velocity_boost"])
                    add_stem(DrumKit(kit_path).render(dchans, SR, length), cfg["level_drums"], "drums")
                else:
                    add_stem(
                        fluid.render(midi_path, chans, SOUNDFONT, SR, exclude_notes=KICK_NOTES), cfg["level_drums"]
                    )
                    kick = fluid.render(midi_path, chans, SOUNDFONT, SR, notes=KICK_NOTES)
                    if np.any(kick):
                        add_stem(kick, cfg["level_kick"])
                hits = [n.start for c in chans if c in channels for n in channels[c].notes if n.pitch in KICK_NOTES]
                if hits:
                    add_stem(synth_kick(hits, n_samples, SR), cfg["level_kick_synth"], "kick_synth")
            elif g == "bass":
                di = fluid.render(midi_path, chans, SOUNDFONT, SR, legato=True, program=cfg["bass_program"])
                add_stem(bass.process(di, SR, drive=cfg["bass_drive"]), cfg["level_bass"], "bass")
            else:
                add_stem(fluid.render(midi_path, chans, SOUNDFONT, SR), cfg["level_" + g], g)

        mix = limiter(mix, SR)

        peak = float(np.abs(mix).max()) + 1e-9
        mix *= 0.89 / peak
        wav = os.path.join(td, "mix.wav")
        sf.write(wav, mix, SR)
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-i",
                wav,
                "-codec:a",
                "libmp3lame",
                "-b:a",
                "192k",
                "-f",
                "mp3",
                out_mp3,
            ],
            check=True,
        )
    info = {
        "seconds": round(length, 1),
        "render_time": round(time.time() - t0, 1),
        "tracks": [t["name"] for t in meta["tracks"]],
    }
    log("done", info)
    return info


if __name__ == "__main__":
    # python -m tabrender.render in.gp out.mp3 ['{"level_guitar": 0, "max_seconds": 20}']
    render(sys.argv[1], sys.argv[2], json.loads(sys.argv[3]) if len(sys.argv) > 3 else None)
