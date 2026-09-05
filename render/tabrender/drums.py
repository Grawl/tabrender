"""Drum helpers: synthetic kick layer and a simple peak limiter."""

from __future__ import annotations

import numpy as np

KICK_NOTES = {35, 36}


def synth_kick(hits: list[float], n_samples: int, sr: int, length: float = 0.25) -> np.ndarray:
    """Sub-sine with a fast pitch drop plus a short noise click at every hit time (seconds)."""
    n = int(length * sr)
    t = np.arange(n) / sr
    freq = 45 + 110 * np.exp(-t * 55)  # 155 Hz -> 45 Hz
    phase = 2 * np.pi * np.cumsum(freq) / sr
    body = np.sin(phase) * np.exp(-t * 12)
    click = np.random.default_rng(0).standard_normal(n) * np.exp(-t * 400) * 0.6
    hit = (body + click).astype(np.float32)
    hit[: int(0.0005 * sr)] *= np.linspace(0, 1, int(0.0005 * sr), dtype=np.float32)
    out = np.zeros(n_samples, dtype=np.float32)
    for h in hits:
        i = int(h * sr)
        if i >= n_samples:
            continue
        seg = hit[: min(n, n_samples - i)]
        out[i : i + len(seg)] += seg
    return out


def limiter(
    x: np.ndarray, sr: int, threshold: float = 0.89, attack: float = 0.001, release: float = 0.08
) -> np.ndarray:
    """Feed-forward peak limiter (no lookahead): gain follows |x| with fast attack, slow release."""
    env = np.max(np.abs(x), axis=1) if x.ndim == 2 else np.abs(x)
    a = np.exp(-1.0 / (attack * sr))
    r = np.exp(-1.0 / (release * sr))
    g = np.empty_like(env)
    e = 0.0
    for i, v in enumerate(env):
        e = v + (a if v > e else r) * (e - v)
        g[i] = e
    gain = np.minimum(1.0, threshold / np.maximum(g, 1e-9)).astype(np.float32)
    return x * (gain[:, None] if x.ndim == 2 else gain)
