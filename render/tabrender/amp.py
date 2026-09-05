"""GuitarML Proteus (RTNeural SimpleRNN/LSTM) inference with torch."""

from __future__ import annotations

import json

import numpy as np
import torch


class ProteusAmp:
    def __init__(self, path: str):
        with open(path) as fh:
            d = json.load(fh)
        md = d["model_data"]
        assert md["unit_type"] == "LSTM" and md["num_layers"] == 1, md
        self.input_size = md["input_size"]
        self.skip = md.get("skip", 1)
        sd = d["state_dict"]
        hidden = md["hidden_size"]
        self.lstm = torch.nn.LSTM(self.input_size, hidden, batch_first=True)
        self.lin = torch.nn.Linear(hidden, 1)
        with torch.no_grad():
            self.lstm.weight_ih_l0.copy_(torch.tensor(sd["rec.weight_ih_l0"]))
            self.lstm.weight_hh_l0.copy_(torch.tensor(sd["rec.weight_hh_l0"]))
            self.lstm.bias_ih_l0.copy_(torch.tensor(sd["rec.bias_ih_l0"]).flatten())
            self.lstm.bias_hh_l0.copy_(torch.tensor(sd["rec.bias_hh_l0"]).flatten())
            self.lin.weight.copy_(torch.tensor(sd["lin.weight"]))
            self.lin.bias.copy_(torch.tensor(sd["lin.bias"]).flatten())
        self.lstm.eval()
        self.lin.eval()

    @torch.no_grad()
    def process(self, x: np.ndarray, knob: float = 0.5, chunk: int = 1 << 16) -> np.ndarray:
        out = np.empty_like(x, dtype=np.float32)
        h = None
        for i in range(0, len(x), chunk):
            seg = torch.tensor(x[i : i + chunk], dtype=torch.float32).view(1, -1, 1)
            if self.input_size == 2:
                seg = torch.cat([seg, torch.full_like(seg, knob)], dim=2)
            y, h = self.lstm(seg, h)
            y = self.lin(y)[..., 0]
            if self.skip:
                y = y + seg[..., 0]
            out[i : i + chunk] = y.view(-1).numpy()
        return out


def _stub_nam_train() -> None:
    """`import nam` eagerly imports nam.train (tkinter, requests, lightning, matplotlib...). Only the model
    loader is needed here, so register an empty nam.train before the package initialises."""
    import sys
    import types

    if "nam.train" not in sys.modules:
        sys.modules["nam.train"] = types.ModuleType("nam.train")


class NamAmp:
    """Neural Amp Modeler capture (.nam) via the neural-amp-modeler package (torch).
    Captures are trained at their own sample rate (usually 48 kHz); audio is resampled around the model."""

    def __init__(self, path: str, sr: int = 44100):
        _stub_nam_train()
        from nam.models._from_nam import init_from_nam  # heavy import, keep lazy

        with open(path) as fh:
            d = json.load(fh)
        self.model = init_from_nam(d)
        self.model.eval()
        self.model_rate = int(d.get("sample_rate") or getattr(self.model, "sample_rate", None) or 48000)
        self.sr = sr
        self.full_rig = True  # tone3000 "amp-cab" captures include the cabinet

    @torch.no_grad()
    def process(self, x: np.ndarray, knob: float = 0.5, chunk: int = 1 << 18) -> np.ndarray:
        import math

        from scipy.signal import resample_poly

        n_in = len(x)
        if self.model_rate != self.sr:
            g = math.gcd(self.model_rate, self.sr)
            x = resample_poly(x, self.model_rate // g, self.sr // g).astype(np.float32)
        rf = int(getattr(self.model, "receptive_field", 8192))
        out = np.empty_like(x, dtype=np.float32)
        for i in range(0, len(x), chunk):
            s0 = max(0, i - rf)
            seg = torch.tensor(x[s0 : i + chunk], dtype=torch.float32).view(1, -1)
            y = self.model(seg).view(-1).numpy()
            n = min(chunk, len(x) - i)
            out[i : i + n] = y[-n:]
        if self.model_rate != self.sr:
            g = math.gcd(self.model_rate, self.sr)
            out = resample_poly(out, self.sr // g, self.model_rate // g).astype(np.float32)
        if len(out) != n_in:  # resampling rounds the length; keep it sample-exact for mixing
            out = np.pad(out, (0, max(0, n_in - len(out))))[:n_in]
        return out


def load_amp(path: str, sr: int = 44100):
    return NamAmp(path, sr) if path.lower().endswith(".nam") else ProteusAmp(path)
