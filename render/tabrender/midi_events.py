"""Parse an SMF (from alphaTab) into per-channel note events in seconds."""
from __future__ import annotations
from dataclasses import dataclass, field
import mido


@dataclass
class Note:
    start: float  # seconds
    end: float
    pitch: int
    velocity: int
    tick: int
    channel: int


@dataclass
class Channel:
    number: int
    program: int = 0
    notes: list[Note] = field(default_factory=list)
    bends: list[tuple[float, float]] = field(default_factory=list)  # (seconds, semitones)
    bend_range: float = 2.0
    volume: int = 100
    pan: int = 64


def _tempo_map(mid: mido.MidiFile):
    """Return list of (tick, seconds, tempo) segments."""
    events = []
    for track in mid.tracks:
        t = 0
        for msg in track:
            t += msg.time
            if msg.type == "set_tempo":
                events.append((t, msg.tempo))
    events.sort()
    segs = []
    tick, sec, tempo = 0, 0.0, 500000
    segs.append((0, 0.0, tempo))
    for et, etempo in events:
        sec += (et - tick) * tempo / 1e6 / mid.ticks_per_beat
        tick, tempo = et, etempo
        segs.append((tick, sec, tempo))
    return segs


def parse(path: str) -> dict[int, Channel]:
    mid = mido.MidiFile(path)
    segs = _tempo_map(mid)
    tpb = mid.ticks_per_beat

    def to_sec(tick: int) -> float:
        lo = 0
        for i, s in enumerate(segs):
            if s[0] <= tick:
                lo = i
            else:
                break
        t0, s0, tempo = segs[lo]
        return s0 + (tick - t0) * tempo / 1e6 / tpb

    channels: dict[int, Channel] = {}
    rpn = {}
    for track in mid.tracks:
        t = 0
        open_notes: dict[tuple[int, int], Note] = {}
        for msg in track:
            t += msg.time
            if not hasattr(msg, "channel"):
                continue
            ch = channels.setdefault(msg.channel, Channel(msg.channel))
            if msg.type == "program_change":
                ch.program = msg.program
            elif msg.type == "note_on" and msg.velocity > 0:
                n = Note(to_sec(t), to_sec(t), msg.note, msg.velocity, t, msg.channel)
                key = (msg.channel, msg.note)
                if key in open_notes:
                    open_notes[key].end = n.start
                open_notes[key] = n
                ch.notes.append(n)
            elif msg.type == "note_off" or (msg.type == "note_on" and msg.velocity == 0):
                key = (msg.channel, msg.note)
                n = open_notes.pop(key, None)
                if n:
                    n.end = to_sec(t)
            elif msg.type == "pitchwheel":
                ch.bends.append((to_sec(t), msg.pitch / 8192.0 * ch.bend_range))
            elif msg.type == "control_change":
                c = msg.control
                if c == 101:
                    rpn[(msg.channel, "msb")] = msg.value
                elif c == 100:
                    rpn[(msg.channel, "lsb")] = msg.value
                elif c == 6 and rpn.get((msg.channel, "msb")) == 0 and rpn.get((msg.channel, "lsb")) == 0:
                    ch.bend_range = float(msg.value)
                    # rescale previously recorded bends (rare)
                elif c == 7:
                    ch.volume = msg.value
                elif c == 10:
                    ch.pan = msg.value
        for n in open_notes.values():
            n.end = max(n.end, n.start + 0.05)
    for ch in channels.values():
        ch.notes.sort(key=lambda n: n.start)
        ch.bends.sort()
    return channels
