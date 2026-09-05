"""Cabinet impulse response convolution."""

from __future__ import annotations

import math

import numpy as np
import soundfile as sf
from scipy.signal import fftconvolve, resample_poly


def load_ir(path: str, sr: int, max_len: float = 0.5) -> np.ndarray:
    ir, fsr = sf.read(path, dtype="float32", always_2d=True)
    ir = ir.mean(axis=1)
    if fsr != sr:
        g = math.gcd(fsr, sr)
        ir = resample_poly(ir, sr // g, fsr // g).astype(np.float32)
    ir = ir[: int(max_len * sr)]
    ir /= np.sqrt(np.sum(ir**2)) + 1e-9  # unit energy
    return ir


def apply(x: np.ndarray, ir: np.ndarray) -> np.ndarray:
    return fftconvolve(x, ir)[: len(x)].astype(np.float32)
