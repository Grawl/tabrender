"""Sampled drum kit (SFZ, GM-mapped) rendered with the one-shot sampler."""

from __future__ import annotations

import numpy as np

from .midi_events import Channel
from .sampler import Articulation, render_notes


class DrumKit:
    def __init__(self, sfz_path: str, root: str | None = None):
        self.art = Articulation(sfz_path, root)

    def render(self, channels: list[Channel], sr: int, length: float) -> np.ndarray:
        notes = sorted((n for ch in channels for n in ch.notes), key=lambda n: n.start)
        return render_notes(
            notes, lambda n: self.art, [], sr, length=length, release=0.5, veltrack=1.0, stereo=True, oneshot=True
        )
