"""Sampled drum kit (SFZ, GM-mapped) rendered with the one-shot sampler."""

from __future__ import annotations

import numpy as np

from .midi_events import Channel
from .sampler import Articulation, render_notes
from .sfz import Region

# GM percussion note -> (Salamander key, semitones). The kit is not GM-mapped above the hi-hat:
# 47 is a cowbell, 48-51 the second ride, 52 the main ride, 55 crash 1, 59/60 chinas, 63 the splash.
# It has two toms (43 floor, 45 rack), the other GM toms are those two resampled up or down.
GM_TO_KIT = {
    35: (35, 0),
    36: (36, 0),
    37: (41, 0),  # side stick -> cross stick
    38: (38, 0),
    39: (41, 0),  # hand clap -> cross stick
    40: (40, 0),
    41: (43, -2),  # low floor tom
    42: (42, 0),
    43: (43, 0),  # high floor tom
    44: (44, 0),
    45: (45, 0),  # low tom
    46: (46, 0),
    47: (45, 2),  # low-mid tom
    48: (45, 3),  # hi-mid tom
    49: (55, 0),  # crash 1
    50: (45, 5),  # high tom
    51: (52, 0),  # ride 1
    52: (60, 0),  # china
    53: (53, 0),  # ride bell
    55: (63, 0),  # splash
    56: (47, 0),  # cowbell
    57: (57, 0),  # crash 2
    59: (48, 0),  # ride 2
}


class GmDrumMap(Articulation):
    """Articulation that looks regions up through GM_TO_KIT; unmapped GM notes stay silent instead of
    falling back to the nearest key (which turned toms into cowbells and crashes into ride bells)."""

    def pick(self, pitch: int, velocity: int, peek: bool = False) -> Region | None:
        m = GM_TO_KIT.get(pitch)
        if m is None:
            return None
        key, semis = m
        r = super().pick(key, velocity, peek)
        if r is None:
            return None
        # the sampler transposes by (note pitch - keycenter): make that exactly `semis`
        return Region({**r, "pitch_keycenter": str(pitch - semis)})


class DrumKit:
    def __init__(self, sfz_path: str, root: str | None = None):
        self.art = GmDrumMap(sfz_path, root)

    def render(self, channels: list[Channel], sr: int, length: float) -> np.ndarray:
        notes = sorted((n for ch in channels for n in ch.notes), key=lambda n: n.start)
        return render_notes(
            notes, lambda n: self.art, [], sr, length=length, release=0.5, veltrack=1.0, stereo=True, oneshot=True
        )
