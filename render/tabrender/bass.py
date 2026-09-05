"""Bass tone: FluidSynth DI -> split-band drive -> compressor (a "clean low / driven high" bass rig)."""

from __future__ import annotations

import numpy as np
from scipy.ndimage import maximum_filter1d
from scipy.signal import butter, lfilter, sosfilt


def _sos(kind: str, freq: float, sr: int, order: int = 2):
    return butter(order, freq, btype=kind, fs=sr, output="sos")


def compress(
    x: np.ndarray, sr: int, threshold_db: float = -18.0, ratio: float = 4.0, attack: float = 0.02, release: float = 0.1
) -> np.ndarray:
    """Vectorised feed-forward compressor: causal peak envelope over the attack window, one-pole release."""
    n = max(1, int(attack * sr))
    env = maximum_filter1d(np.abs(x), size=n, origin=n - 1 - n // 2)  # window ends at the current sample
    r = np.exp(-1.0 / (release * sr))
    env = lfilter([1 - r], [1, -r], env).astype(np.float32)
    thr = 10 ** (threshold_db / 20)
    over = np.maximum(env, thr) / thr
    gain = over ** (1.0 / ratio - 1.0)
    return (x * gain).astype(np.float32)


def process(
    stem: np.ndarray,
    sr: int,
    crossover: float = 300.0,
    drive: float = 6.0,
    high_mix: float = 0.8,
    high_lpf: float = 4500.0,
) -> np.ndarray:
    x = stem.mean(axis=1) if stem.ndim == 2 else stem
    x = x / (float(np.abs(x).max()) + 1e-9) * 0.5
    x = sosfilt(_sos("highpass", 30, sr), x)
    low = sosfilt(_sos("lowpass", crossover, sr), x)
    high = sosfilt(_sos("highpass", crossover, sr), x)
    high = np.tanh(high * drive) / np.tanh(drive * 0.5)
    high = sosfilt(_sos("lowpass", high_lpf, sr), high)
    y = compress((low + high * high_mix).astype(np.float32), sr)
    return y / (float(np.abs(y).max()) + 1e-9)
