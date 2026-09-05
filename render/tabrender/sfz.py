"""Minimal SFZ parser: regions with inherited <global>/<master>/<group> opcodes."""

from __future__ import annotations

import os
import re

_NOTE = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}


def note_number(s: str) -> int:
    s = s.strip().lower()
    if re.fullmatch(r"-?\d+", s):
        return int(s)
    m = re.fullmatch(r"([a-g])([#b]?)(-?\d+)", s)
    if not m:
        raise ValueError(f"bad note {s!r}")
    n = _NOTE[m.group(1)] + (1 if m.group(2) == "#" else -1 if m.group(2) == "b" else 0)
    return (int(m.group(3)) + 1) * 12 + n


class Region(dict):
    @property
    def lokey(self) -> int:
        return note_number(self.get("lokey", self.get("key", "0")))

    @property
    def hikey(self) -> int:
        return note_number(self.get("hikey", self.get("key", "127")))

    @property
    def keycenter(self) -> int:
        return note_number(self.get("pitch_keycenter", self.get("key", "60")))

    @property
    def lovel(self) -> int:
        return int(self.get("lovel", 0))

    @property
    def hivel(self) -> int:
        return int(self.get("hivel", 127))

    @property
    def seq_length(self) -> int:
        return int(self.get("seq_length", 1))

    @property
    def seq_position(self) -> int:
        return int(self.get("seq_position", 1))

    def f(self, name: str, default: float = 0.0) -> float:
        return float(self.get(name, default))


def parse(path: str, root: str | None = None) -> list[Region]:
    """root: directory of the top-level .sfz (sample paths resolve against it)."""
    regions: list[Region] = []
    base = os.path.dirname(path)
    root = root or base
    defines: dict[str, str] = {}
    ctx = {"global": {}, "master": {}, "group": {}}
    cur: dict | None = None
    cur_kind = None
    default_path = ""

    def flush():
        nonlocal cur
        if cur is not None and cur_kind == "region":
            r = Region()
            for k in ("global", "master", "group"):
                r.update(ctx[k])
            r.update(cur)
            if "sample" in r:
                s = r["sample"].replace("\\", "/")
                r["sample"] = os.path.normpath(os.path.join(root, default_path, s))
                regions.append(r)
        cur = None

    def handle_line(line: str):
        nonlocal cur, cur_kind, default_path
        line = line.split("//")[0].strip()
        if not line:
            return
        if line.startswith("#include"):
            inc = re.search(r'"(.*)"', line).group(1).replace("\\", "/")
            flush()
            regions.extend(parse(os.path.join(base, inc), root))
            return
        if line.startswith("#define"):
            _, k, v = line.split(None, 2)
            defines[k] = v
            return
        for k, v in defines.items():
            line = line.replace(k, v)
        # split into headers and key=value tokens (values may contain spaces for sample=)
        tokens = re.split(r"(?=<\w+>)", line)
        for tok in tokens:
            tok = tok.strip()
            if not tok:
                continue
            m = re.match(r"<(\w+)>(.*)", tok, re.S)
            if m:
                flush()
                kind = m.group(1)
                cur_kind = kind
                if kind in ctx:
                    ctx[kind] = {}
                    if kind == "global":
                        ctx["master"] = {}
                        ctx["group"] = {}
                    elif kind == "master":
                        ctx["group"] = {}
                    cur = ctx[kind]
                elif kind == "region":
                    cur = {}
                else:  # control, curve, effect
                    cur = {}
                rest = m.group(2).strip()
            else:
                rest = tok
            # key=value pairs; sample paths may contain spaces: split on ' key=' boundaries
            for kv in re.split(r"\s+(?=[a-zA-Z_][\w]*=)", rest):
                if "=" not in kv:
                    continue
                k, v = kv.split("=", 1)
                k, v = k.strip(), v.strip()
                if cur_kind == "control":
                    if k == "default_path":
                        default_path = v.replace("\\", "/")
                    continue
                if cur is not None:
                    cur[k] = v

    with open(path, encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            handle_line(line)
    flush()
    return regions
