"""Guitar/bass DI rendering with articulation selection + amp + cab."""
from __future__ import annotations
import os
import numpy as np
import numpy as np
from scipy.signal import butter, sosfilt
from .sampler import Articulation, render_notes
from .midi_events import Note, Channel
from . import amp as ampmod, cab as cabmod


class GuitarKit:
    """One SFZ library: sustain / palm-mute articulations."""

    def __init__(self, root: str, patch_dir: str, sustain: str = "Sus_Down.sfz", mute: str = "Mute_Down.sfz", offset_ms: float = 0.0):
        self.sus = Articulation(os.path.join(patch_dir, sustain), root)
        self.mute = Articulation(os.path.join(patch_dir, mute), root)

    def render(self, ch: Channel, articulations: dict[str, list[str]], track_index: int, sr: int, length: float,
               take: int = 0) -> np.ndarray:
        """take > 0 renders an alternative performance for double tracking: different round-robins,
        a few ms of timing slop and slight detune."""
        rng = np.random.default_rng(100 + take)
        if take:
            for art in (self.sus, self.mute):
                art._rr = {k: v + take for k, v in art._rr.items()}
                art._rr_shift = take

        def art_for(n: Note):
            flags = articulations.get(f"{track_index}:{n.tick}:{n.pitch}", ())
            if "dead" in flags:
                return self.mute
            return self.mute if "pm" in flags else self.sus

        notes = _legato(ch.notes, articulations, track_index)
        if take:
            notes = [Note(n.start + float(rng.uniform(0.004, 0.012)), n.end + float(rng.uniform(0.004, 0.012)), n.pitch, n.velocity, n.tick, n.channel) for n in notes]
            bends = [(t, v + 0.03) for t, v in ch.bends] or [(0.0, 0.03)]
        else:
            bends = ch.bends
        return render_notes(notes, art_for, bends, sr, length=length, release=0.12)


def _legato(notes: list[Note], articulations, track_index: int, min_pm: float = 0.22, gap: float = 0.03) -> list[Note]:
    """Extend note ends so consecutive notes overlap slightly (no gaps between picked notes);
    palm-muted notes get a minimum length so the mute sample decays naturally."""
    out = []
    by_start = sorted(notes, key=lambda n: n.start)
    for i, n in enumerate(by_start):
        end = n.end
        flags = articulations.get(f"{track_index}:{n.tick}:{n.pitch}", ())
        if "pm" in flags or "dead" in flags:
            end = max(end, n.start + min_pm)
        else:
            end = max(end, n.start + 0.1)
        # next note anywhere on this channel: let this one ring slightly past it
        nxt = next((m for m in by_start[i + 1 :] if m.start > n.start + 1e-3), None)
        if nxt is not None:
            end = max(min(end, nxt.start + gap), n.start + 0.05) if "pm" in flags else max(end, min(nxt.start + gap, n.end + 0.15))
        out.append(Note(n.start, end, n.pitch, n.velocity, n.tick, n.channel))
    return out


def _sos(kind: str, freq: float, sr: int, order: int = 2):
    return butter(order, freq, btype=kind, fs=sr, output="sos")


class AmpChain:
    """DI -> tightening high-pass ("boost pedal" style) -> amp capture -> cab IR -> post EQ."""

    def __init__(self, amp_json: str, ir_wav: str | None, sr: int, input_gain: float = 1.0, knob: float = 0.5,
                 pre_hpf: float = 0.0, post_hpf: float = 0.0, post_lpf: float = 0.0):
        self.amp = ampmod.load_amp(amp_json, sr)
        # full-rig captures already include the cabinet: skip the IR unless one is forced
        self.ir = None if (getattr(self.amp, "full_rig", False) and not ir_wav) else cabmod.load_ir(ir_wav, sr)
        self.input_gain = input_gain
        self.knob = knob
        self.sr = sr
        self.pre = _sos("highpass", pre_hpf, sr, 1) if pre_hpf else None
        self.post = [f for f in (
            _sos("highpass", post_hpf, sr, 2) if post_hpf else None,
            _sos("lowpass", post_lpf, sr, 2) if post_lpf else None,
        ) if f is not None]

    def process(self, di: np.ndarray) -> np.ndarray:
        peak = float(np.abs(di).max()) + 1e-9
        x = di / peak * 0.5 * self.input_gain  # normalise DI to a sane level for the model
        if self.pre is not None:
            x = sosfilt(self.pre, x)
        y = self.amp.process(x.astype(np.float32), self.knob)
        z = cabmod.apply(y, self.ir) if self.ir is not None else y
        for f in self.post:
            z = sosfilt(f, z).astype(np.float32)
        return z / (float(np.abs(z).max()) + 1e-9)
