"""Tiny one-shot SFZ sampler with pitch-bend-aware resampling."""

from __future__ import annotations

import functools
import math

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

from .midi_events import Note
from .sfz import Region, parse


@functools.lru_cache(maxsize=4096)
def _load(path: str, sr: int, stereo: bool = False) -> np.ndarray:
    data, fsr = sf.read(path, dtype="float32", always_2d=True)
    if stereo:
        if data.shape[1] == 1:
            data = np.repeat(data, 2, axis=1)
        data = data[:, :2]
    else:
        data = data.mean(axis=1)
    if fsr != sr:
        g = math.gcd(fsr, sr)
        data = resample_poly(data, sr // g, fsr // g, axis=0).astype(np.float32)
    return np.ascontiguousarray(data)


class Articulation:
    def __init__(self, sfz_path: str, root: str | None = None):
        # drop regions that need a held sustain pedal (cc64) or other non-default cc switches
        self.regions = [r for r in parse(sfz_path, root) if float(r.get("locc64", 0)) <= 0]
        self._rr: dict[tuple[int, int], int] = {}
        self._rng = np.random.default_rng(1234)

    def pick(self, pitch: int, velocity: int, peek: bool = False) -> Region | None:
        cands = [r for r in self.regions if r.lokey <= pitch <= r.hikey and r.lovel <= velocity <= r.hivel]
        if cands and any("lorand" in r or "hirand" in r for r in cands):
            x = 0.5 if peek else float(self._rng.random())
            rnd = [r for r in cands if r.f("lorand", 0) <= x < r.f("hirand", 1)]
            return rnd[0] if rnd else cands[0]
        if not cands:
            # nearest key range (for notes below/above sampled range)
            below = [r for r in self.regions if r.lovel <= velocity <= r.hivel]
            if not below:
                return None
            best = min(below, key=lambda r: min(abs(pitch - r.lokey), abs(pitch - r.hikey)))
            cands = [r for r in below if (r.lokey, r.hikey) == (best.lokey, best.hikey)]
        key = (cands[0].lokey, cands[0].hikey)
        seq_len = max(r.seq_length for r in cands)
        n = self._rr.get(key, 0)
        if not peek:
            self._rr[key] = n + 1
        pos = (n % seq_len) + 1
        for r in cands:
            if r.seq_position == pos:
                return r
        return cands[0]


def _envelope(
    n: int, sr: int, attack: float, decay: float, sustain: float, hold_samples: int, release: float
) -> np.ndarray:
    env = np.ones(n, dtype=np.float32)
    a = max(1, int(attack * sr))
    env[: min(a, n)] = np.linspace(0, 1, min(a, n), dtype=np.float32)
    if decay > 0 and sustain < 1:
        d = int(decay * sr)
        seg = np.linspace(1, sustain, min(d, max(0, n - a)), dtype=np.float32)
        env[a : a + len(seg)] *= seg
        env[a + len(seg) :] *= sustain
    r = max(1, int(release * sr))
    if hold_samples < n:
        tail = np.linspace(1, 0, min(r, n - hold_samples), dtype=np.float32)
        env[hold_samples : hold_samples + len(tail)] *= tail
        env[hold_samples + len(tail) :] = 0
    return env


def render_notes(
    notes: list[Note],
    art_for: callable,
    bends: list[tuple[float, float]],
    sr: int = 44100,
    length: float | None = None,
    release: float = 0.08,
    veltrack: float = 1.0,
    stereo: bool = False,
    oneshot: bool = False,
) -> np.ndarray:
    """art_for(note) -> Articulation. Returns float32 buffer, mono or (n, 2).
    oneshot: ignore note-off, play the whole sample (drums); regions with group/off_by choke each other."""
    total = length or (max(n.end for n in notes) + 2.0)
    n_out = int(total * sr) + sr
    out = np.zeros((n_out, 2) if stereo else n_out, dtype=np.float32)
    # pre-pass: when does each choke group get triggered (for off_by cutting of earlier notes)
    chokes: list[tuple[int, int]] = []  # (start_sample, group)
    for note in notes:
        art = art_for(note)
        region = art.pick(note.pitch, note.velocity, peek=True) if art else None
        if region is not None and region.f("group", 0):
            chokes.append((int(note.start * sr), int(region.f("group", 0))))
    chokes.sort()
    bt = np.array([b[0] for b in bends] or [0.0])
    bv = np.array([b[1] for b in bends] or [0.0])
    for note in notes:
        art = art_for(note)
        region = art.pick(note.pitch, note.velocity) if art else None
        if region is None:
            continue
        smp = _load(region["sample"], sr, stereo)
        off = int(region.f("offset", 0))
        smp = smp[off:]
        hold = len(smp) if oneshot else max(int((note.end - note.start) * sr), int(0.02 * sr))
        n = min(len(smp), hold + int(release * sr) + 1)
        # time-varying pitch ratio: base transposition + pitch bend (semitones)
        base = note.pitch - region.keycenter + region.f("transpose", 0) + region.f("tune", 0) / 100.0
        t = note.start + np.arange(n, dtype=np.float64) / sr
        bend = np.interp(t, bt, bv, left=bv[0], right=bv[-1]) if len(bt) > 1 else 0.0
        ratio = 2.0 ** ((base + bend) / 12.0)
        pos = np.cumsum(np.atleast_1d(ratio) * np.ones(n))
        pos = np.concatenate(([0.0], pos[:-1]))
        valid = pos < len(smp) - 1
        n = int(valid.sum())
        if n <= 0:
            continue
        idx = np.arange(len(smp))
        if stereo:
            seg = np.stack([np.interp(pos[:n], idx, smp[:, 0]), np.interp(pos[:n], idx, smp[:, 1])], axis=1).astype(
                np.float32
            )
        else:
            seg = np.interp(pos[:n], idx, smp).astype(np.float32)
        start = int(note.start * sr)
        # choke: a note in group G cuts every active note whose off_by == G (e.g. closed hi-hat stops open one)
        off_by = int(region.f("off_by", 0))
        if off_by:
            later = [c for c in chokes if c[1] == off_by and c[0] > start]
            if later:
                cut = later[0][0] - start + int(0.03 * sr)
                hold = min(hold, max(cut, 1))
                n = min(n, hold + int(0.03 * sr))
                seg = seg[:n]
        env = _envelope(
            n,
            sr,
            region.f("ampeg_attack", 0.001),
            region.f("ampeg_decay", 0),
            region.f("ampeg_sustain", 100) / 100.0,
            hold,
            max(release, region.f("ampeg_release", 0)),
        )
        vel = 1.0 - veltrack * (1.0 - note.velocity / 127.0)
        gain = 10 ** (region.f("volume", 0) / 20.0) * vel
        end = min(start + n, len(out))
        e = env[: end - start]
        out[start:end] += seg[: end - start] * (e[:, None] if stereo else e) * gain
    return out
