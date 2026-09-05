"""Render selected MIDI channels through FluidSynth (drums, bass, keys...)."""
from __future__ import annotations
import os
import subprocess
import tempfile
import mido
import numpy as np
import soundfile as sf


def _filter_midi(src: str, dst: str, channels: set[int], notes: set[int] | None = None, exclude_notes: set[int] | None = None) -> None:
    """Keep messages on `channels`; note events additionally filtered by pitch (notes / exclude_notes)."""
    mid = mido.MidiFile(src)
    out = mido.MidiFile(ticks_per_beat=mid.ticks_per_beat, type=mid.type)
    for track in mid.tracks:
        nt = mido.MidiTrack()
        pending = 0
        for msg in track:
            pending += msg.time
            keep = (not hasattr(msg, "channel")) or msg.channel in channels
            if keep and msg.type in ("note_on", "note_off"):
                if notes is not None and msg.note not in notes:
                    keep = False
                if exclude_notes is not None and msg.note in exclude_notes:
                    keep = False
            if keep:
                nt.append(msg.copy(time=pending))
                pending = 0
        out.tracks.append(nt)
    out.save(dst)


def render(midi_path: str, channels: set[int], soundfont: str, sr: int, gain: float = 0.6,
           notes: set[int] | None = None, exclude_notes: set[int] | None = None) -> np.ndarray:
    with tempfile.TemporaryDirectory() as td:
        part = os.path.join(td, "part.mid")
        wav = os.path.join(td, "part.wav")
        _filter_midi(midi_path, part, channels, notes, exclude_notes)
        subprocess.run(
            ["fluidsynth", "-ni", "-q", "-r", str(sr), "-g", str(gain), "-F", wav, soundfont, part],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        data, fsr = sf.read(wav, dtype="float32", always_2d=True)
    assert fsr == sr
    return data  # stereo (n, 2)
