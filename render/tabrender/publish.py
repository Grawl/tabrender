"""Publish band subsets of data/tabs into read-only per-band player instances.

TABRENDER_PUBLISH="band-a=Band A:/bands/band-a/tabs;band-b=Band B:/bands/band-b/tabs"
Every main tab whose artist matches the band name is mirrored (tab file, render.mp3, companion audio,
config.json once) into the instance's tabs folder. Tabs removed from the main instance are removed too.
"""

from __future__ import annotations

import contextlib
import json
import os
import shutil

from .render import log

COPY_EXTS = (".gp", ".gpx", ".gp3", ".gp4", ".gp5", ".musicxml", ".capx", ".mp3", ".ogg")


def _targets() -> list[tuple[str, str]]:
    spec = os.environ.get("TABRENDER_PUBLISH", "")
    out = []
    for item in filter(None, (s.strip() for s in spec.split(";"))):
        _, rest = item.split("=", 1)
        band, target = rest.rsplit(":", 1)
        out.append((band.strip(), target.strip()))
    return out


def _copy_if_newer(src: str, dst: str) -> bool:
    if (
        os.path.exists(dst)
        and os.path.getsize(dst) == os.path.getsize(src)
        and int(os.path.getmtime(src)) <= int(os.path.getmtime(dst))
    ):
        return False
    shutil.copy2(src, dst)
    return True


def _artist(tab_dir: str) -> str:
    with contextlib.suppress(Exception), open(os.path.join(tab_dir, "config.json")) as fh:
        return json.load(fh)["tab"].get("artist", "")
    return ""


def publish(tabs_dir: str) -> None:
    for band, target in _targets():
        os.makedirs(target, exist_ok=True)
        wanted: set[str] = set()
        for entry in sorted(os.listdir(tabs_dir)):
            src_dir = os.path.join(tabs_dir, entry)
            if not os.path.isdir(src_dir) or _artist(src_dir).strip().lower() != band.lower():
                continue
            wanted.add(entry)
            dst_dir = os.path.join(target, entry)
            os.makedirs(dst_dir, exist_ok=True)
            for name in os.listdir(src_dir):
                src = os.path.join(src_dir, name)
                if not os.path.isfile(src) or name.startswith("."):
                    continue
                if name == "config.json":
                    if not os.path.exists(os.path.join(dst_dir, name)):
                        shutil.copy2(src, os.path.join(dst_dir, name))
                elif name.lower().endswith(COPY_EXTS) and _copy_if_newer(src, os.path.join(dst_dir, name)):
                    log(f"publish {band}: {entry}/{name}")
        for entry in os.listdir(target):
            if entry not in wanted and os.path.isdir(os.path.join(target, entry)):
                shutil.rmtree(os.path.join(target, entry))
                log(f"publish {band}: removed {entry}")
