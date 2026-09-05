"""Render selected MIDI channels through FluidSynth (drums, bass, keys...)."""

from __future__ import annotations

import os
import subprocess
import tempfile

import mido
import numpy as np
import soundfile as sf


def _filter_midi(
    src: str,
    dst: str,
    channels: set[int],
    notes: set[int] | None = None,
    exclude_notes: set[int] | None = None,
    legato: bool = False,
    program: int | None = None,
) -> None:
    """Keep messages on `channels`; note events additionally filtered by pitch (notes / exclude_notes).
    legato: delay every note-off so the note overlaps the next one on its channel a little (no gaps between
    picked notes; rests stay rests). program: force this program on the kept channels."""
    mid = mido.MidiFile(src)
    out = mido.MidiFile(ticks_per_beat=mid.ticks_per_beat, type=mid.type)
    overlap, max_extend = mid.ticks_per_beat // 16, mid.ticks_per_beat // 4
    for track in mid.tracks:
        events: list[tuple[int, int, mido.Message]] = []  # (abs tick, order, msg)
        t = 0
        for msg in track:
            t += msg.time
            keep = (not hasattr(msg, "channel")) or msg.channel in channels
            if keep and msg.type in ("note_on", "note_off"):
                if notes is not None and msg.note not in notes:
                    keep = False
                if exclude_notes is not None and msg.note in exclude_notes:
                    keep = False
            if keep and program is not None and msg.type == "program_change":
                msg = msg.copy(program=program)
            if keep:
                events.append((t, len(events), msg))
        if legato:
            events = _legato(events, overlap, max_extend)
        nt = mido.MidiTrack()
        prev = 0
        for t, _, msg in sorted(events, key=lambda e: (e[0], e[1])):
            nt.append(msg.copy(time=t - prev))
            prev = t
        out.tracks.append(nt)
    out.save(dst)


def _legato(events: list[tuple[int, int, mido.Message]], overlap: int, max_extend: int) -> list:
    def is_on(m):
        return m.type == "note_on" and m.velocity > 0

    def is_off(m):
        return m.type == "note_off" or (m.type == "note_on" and m.velocity == 0)

    ons: dict = {}  # channel -> note-on ticks; (channel, note) -> note-on ticks
    for t, _, m in events:
        if is_on(m):
            ons.setdefault(m.channel, []).append(t)
            ons.setdefault((m.channel, m.note), []).append(t)
    out = []
    open_notes: dict[tuple[int, int], int] = {}
    for t, order, m in events:
        if is_on(m):
            open_notes[(m.channel, m.note)] = t
        elif is_off(m):
            start = open_notes.pop((m.channel, m.note), None)
            if start is not None:
                nxt = next((s for s in ons.get(m.channel, []) if s > start), None)
                if nxt is not None:
                    t = max(t, min(nxt + overlap, t + max_extend))
                # never past the next hit of the same key: a late note-off would silence that note instead
                same = next((s for s in ons.get((m.channel, m.note), []) if s > start), None)
                if same is not None:
                    t = min(t, same - 1)
        out.append((t, order, m))
    return out


def render(
    midi_path: str,
    channels: set[int],
    soundfont: str,
    sr: int,
    gain: float = 0.6,
    notes: set[int] | None = None,
    exclude_notes: set[int] | None = None,
    legato: bool = False,
    program: int | None = None,
) -> np.ndarray:
    with tempfile.TemporaryDirectory() as td:
        part = os.path.join(td, "part.mid")
        wav = os.path.join(td, "part.wav")
        _filter_midi(midi_path, part, channels, notes, exclude_notes, legato, program)
        subprocess.run(
            ["fluidsynth", "-ni", "-q", "-r", str(sr), "-g", str(gain), "-F", wav, soundfont, part],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        data, fsr = sf.read(wav, dtype="float32", always_2d=True)
    assert fsr == sr
    return data  # stereo (n, 2)
