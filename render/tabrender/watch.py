"""Watch It's MyTabs data/tabs; render an MP3 next to every tab file (picked up as audio automatically)."""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
import traceback

from .dropbox_import import sync_and_import
from .publish import publish
from .render import log, render

TAB_EXTS = (".gp", ".gpx", ".gp3", ".gp4", ".gp5", ".musicxml", ".xml", ".capx")
OUT_NAME = os.environ.get("TABRENDER_OUT_NAME", "render.mp3")
STATE_NAME = ".render.json"
VERSION = 13  # bump to force re-render after pipeline changes


def _save(path: str, obj: dict) -> None:
    with open(path, "w") as fh:
        json.dump(obj, fh)


def _sha(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _tab_file(d: str) -> str | None:
    for name in sorted(os.listdir(d)):
        if name.lower().endswith(TAB_EXTS) and os.path.isfile(os.path.join(d, name)):
            return os.path.join(d, name)
    return None


def _priority(tabs_dir: str, entry: str) -> tuple:
    """Manually uploaded tabs first, then Dropbox tabs from band folders, then root-level covers."""
    if not entry.startswith("db-"):
        return (0, entry)
    try:
        with open(os.path.join(tabs_dir, entry, "config.json")) as fh:
            artist = json.load(fh)["tab"].get("artist", "")
    except Exception:
        artist = ""
    return (1 if artist else 2, entry)


def render_next(tabs_dir: str) -> bool:
    """Render the first tab whose render.mp3 is missing or stale; True if one was rendered."""
    for entry in sorted(os.listdir(tabs_dir), key=lambda e: _priority(tabs_dir, e)):
        d = os.path.join(tabs_dir, entry)
        if entry == "deleted" or not os.path.isdir(d):
            continue
        tab = _tab_file(d)
        if not tab:
            continue
        state_path = os.path.join(d, STATE_NAME)
        out_path = os.path.join(d, OUT_NAME)
        state = {}
        if os.path.exists(state_path):
            try:
                with open(state_path) as fh:
                    state = json.load(fh)
            except Exception:
                state = {}
        sha = _sha(tab)
        if state.get("sha") == sha and state.get("version") == VERSION and os.path.exists(out_path):
            continue
        if state.get("sha") == sha and state.get("version") == VERSION and state.get("error"):
            continue  # do not retry a failing file forever; bump VERSION or change the file
        log(f"rendering {tab}")
        tmp = os.path.join(d, ".render.tmp")
        try:
            info = render(tab, tmp)
            os.replace(tmp, out_path)
            _save(state_path, {"sha": sha, "version": VERSION, "info": info, "at": time.time()})
        except Exception as e:
            traceback.print_exc()
            _save(state_path, {"sha": sha, "version": VERSION, "error": str(e), "at": time.time()})
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
        return True
    return False


def main() -> None:
    tabs_dir = sys.argv[1] if len(sys.argv) > 1 else "/data/tabs"
    interval = float(os.environ.get("TABRENDER_INTERVAL", "15"))
    log(f"watching {tabs_dir} every {interval}s")
    while True:
        try:
            sync_and_import(tabs_dir)
            publish(tabs_dir)  # new tabs (and every fresh render.mp3) reach the band instances right away
            if render_next(tabs_dir):
                continue  # one tab per pass, so publishing keeps up with the queue
        except Exception:
            traceback.print_exc()
        time.sleep(interval)


if __name__ == "__main__":
    main()
