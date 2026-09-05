"""Mirror a Dropbox folder with rclone and import every tab file into It's MyTabs' data/tabs.

Layout in Dropbox:  <root>/<Band>/<Song>.gp   ->  data/tabs/db-<band>-<song>/<Song>.gp (+ config.json)
                    <root>/<Song>.gp          ->  data/tabs/db-<song>/<Song>.gp (artist empty)
Deeper folders are ignored.
An .mp3/.ogg next to the tab with the same name is copied along as audio.
The tab id is derived from the path, so re-syncs update the same tab; It's MyTabs auto-creates
config.json for unknown folders, but we write it ourselves to set title/artist/public.
"""
from __future__ import annotations
import json
import os
import re
import shutil
import subprocess
import time
import unicodedata
from .render import log

TAB_EXTS = (".gp", ".gpx", ".gp3", ".gp4", ".gp5", ".musicxml", ".capx")
AUDIO_EXTS = (".mp3", ".ogg")
ID_PREFIX = "db-"


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = re.sub(r"[^\w\s-]", "", s, flags=re.U).strip().lower()
    s = re.sub(r"[\s_-]+", "-", s)
    return s[:60] or "x"


def rclone_sync(remote: str, mirror: str, config: str) -> bool:
    cmd = ["rclone", "sync", remote, mirror, "--config", config, "--fast-list", "--exclude", ".*/**", "--exclude", "*.tmp"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        log("rclone sync failed:", r.stderr.strip()[-400:])
        return False
    return True


def _copy_if_newer(src: str, dst: str) -> bool:
    if os.path.exists(dst) and os.path.getsize(dst) == os.path.getsize(src) and int(os.path.getmtime(src)) <= int(os.path.getmtime(dst)):
        return False
    shutil.copy2(src, dst)
    return True


def import_mirror(mirror: str, tabs_dir: str, public: bool = True) -> int:
    changed = 0
    for root, dirs, files in os.walk(mirror):
        rel = os.path.relpath(root, mirror)
        # only <root>/<Song> and <root>/<Band>/<Song>: deeper folders (misc, old versions) are skipped
        dirs[:] = sorted(d for d in dirs if not d.startswith(".")) if rel == "." else []
        band = "" if rel == "." else rel.split(os.sep)[0]
        for name in sorted(files):
            src = os.path.join(root, name)
            stem, ext = os.path.splitext(name)
            if name.startswith(".") or ext.lower() not in TAB_EXTS:
                continue
            parts = [slug(x) for x in ([] if rel == "." else rel.split(os.sep))] + [slug(stem)]
            if ext.lower() != ".gp":
                parts.append(ext.lower().lstrip("."))  # same song in .gp and .gpx stay separate tabs
            tab_id = ID_PREFIX + "-".join(parts)
            tdir = os.path.join(tabs_dir, tab_id)
            os.makedirs(tdir, exist_ok=True)
            for old in os.listdir(tdir):  # renamed/replaced tab file
                if old != name and old.lower().endswith(TAB_EXTS):
                    os.remove(os.path.join(tdir, old))
            if _copy_if_newer(src, os.path.join(tdir, name)):
                changed += 1
                log(f"dropbox: imported {rel}/{name} -> {tab_id}")
            for aext in AUDIO_EXTS:  # companion audio with the same name
                asrc = os.path.join(root, stem + aext)
                if os.path.isfile(asrc) and _copy_if_newer(asrc, os.path.join(tdir, stem + aext)):
                    log(f"dropbox: audio {rel}/{stem}{aext} -> {tab_id}")
            cfg_path = os.path.join(tdir, "config.json")
            cfg = {"tab": {}, "audio": [], "youtube": []}
            if os.path.exists(cfg_path):
                try:
                    cfg = json.load(open(cfg_path))
                except Exception:
                    pass
            tab = cfg.setdefault("tab", {})
            new = {
                "id": tab_id,
                "title": tab.get("title") or stem,
                "artist": tab.get("artist") or band,
                "filename": name,
                "originalFilename": name,
                "createdAt": tab.get("createdAt") or time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
                "public": tab.get("public", public),
                "fav": tab.get("fav", False),
            }
            if tab.get("lastAccessAt"):
                new["lastAccessAt"] = tab["lastAccessAt"]
            if new != tab:
                cfg["tab"] = new
                json.dump(cfg, open(cfg_path, "w"), indent=2, ensure_ascii=False)
    return changed


def sync_and_import(tabs_dir: str) -> None:
    remote = os.environ.get("TABRENDER_DROPBOX_REMOTE")  # e.g. dropbox:Tabs
    if not remote:
        return
    config = os.environ.get("RCLONE_CONFIG", "/rclone/rclone.conf")
    mirror = os.environ.get("TABRENDER_DROPBOX_MIRROR", "/data/dropbox-mirror")
    os.makedirs(mirror, exist_ok=True)
    if rclone_sync(remote, mirror, config):
        import_mirror(mirror, tabs_dir, public=os.environ.get("TABRENDER_DROPBOX_PUBLIC", "1") == "1")
