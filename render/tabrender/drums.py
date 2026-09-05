"""Drum helpers: synthetic kick layer and a simple peak limiter."""

from __future__ import annotations

import numpy as np
from scipy.ndimage import minimum_filter1d, uniform_filter1d
from scipy.signal import lfilter

KICK_NOTES = {35, 36}


def synth_kick(hits: list[float], n_samples: int, sr: int, length: float = 0.25) -> np.ndarray:
    """Sub-sine with a fast pitch drop plus a short noise click at every hit time (seconds).
    A hit chokes the previous one (fast rolls must not pile up into a drone)."""
    n = int(length * sr)
    t = np.arange(n) / sr
    freq = 45 + 110 * np.exp(-t * 55)  # 155 Hz -> 45 Hz
    phase = 2 * np.pi * np.cumsum(freq) / sr
    body = np.sin(phase) * np.exp(-t * 12)
    click = np.random.default_rng(0).standard_normal(n) * np.exp(-t * 400) * 0.6
    hit = (body + click).astype(np.float32)
    hit[: int(0.0005 * sr)] *= np.linspace(0, 1, int(0.0005 * sr), dtype=np.float32)
    fade = int(0.003 * sr)
    out = np.zeros(n_samples, dtype=np.float32)
    starts = sorted(int(h * sr) for h in hits)
    for k, i in enumerate(starts):
        if i >= n_samples:
            continue
        seg = hit[: min(n, n_samples - i)].copy()
        if k + 1 < len(starts):
            cut = starts[k + 1] - i
            if cut < len(seg):
                seg = seg[:cut]
                seg[-fade:] *= np.linspace(1, 0, min(fade, len(seg)), dtype=np.float32)
        out[i : i + len(seg)] += seg
    return out


def limiter(
    x: np.ndarray, sr: int, threshold: float = 0.89, lookahead: float = 0.005, hold: float = 0.05, release: float = 0.08
) -> np.ndarray:
    """Look-ahead peak limiter: the gain reaches the needed reduction before the peak (no clicks on
    transients), holds it, then releases. Vectorised: min-filter over [t - hold, t + lookahead],
    two box smoothings within the look-ahead, slow release via a one-pole."""
    env = np.max(np.abs(x), axis=1) if x.ndim == 2 else np.abs(x)
    need = np.minimum(1.0, threshold / np.maximum(env, 1e-9))
    la, hd = max(1, int(lookahead * sr)), max(1, int(hold * sr))
    size = la + hd + 1
    g = minimum_filter1d(need, size=size, origin=hd - size // 2)
    g = uniform_filter1d(uniform_filter1d(g, size=la), size=la)
    r = np.exp(-1.0 / (release * sr))
    slow = lfilter([1 - r], [1, -r], g)
    gain = np.minimum(g, slow).astype(np.float32)
    return x * (gain[:, None] if x.ndim == 2 else gain)
