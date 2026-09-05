"""Mirror a Dropbox folder with rclone and import every tab file into It's MyTabs' data/tabs.

Layout in Dropbox:  <root>/<Band>/<Song>.gp   ->  data/tabs/db-<band>-<song>/<Song>.gp (+ config.json)
                    <root>/<Song>.gp          ->  data/tabs/db-<song>/<Song>.gp (artist empty)
Deeper folders are ignored.
An .mp3/.ogg next to the tab with the same name is copied along as audio.
The tab id is derived from the path, so re-syncs update the same tab; It's MyTabs auto-creates
config.json for unknown folders, but we write it ourselves to set title/artist/public.
"""

from __future__ import annotations

import contextlib
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
    cmd = [
        "rclone",
        "sync",
        remote,
        mirror,
        "--config",
        config,
        "--fast-list",
        "--exclude",
        ".*/**",
        "--exclude",
        "*.tmp",
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        log("rclone sync failed:", r.stderr.strip()[-400:])
        return False
    return True


def _copy_if_newer(src: str, dst: str) -> bool:
    if (
        os.path.exists(dst)
        and os.path.getsize(dst) == os.path.getsize(src)
        and int(os.path.getmtime(src)) <= int(os.path.getmtime(dst))
    ):
        return False
    shutil.copy2(src, dst)
    return True


IGNORE_DIRS = tuple(
    x.strip().lower() for x in os.environ.get("TABRENDER_DROPBOX_IGNORE", "misc,хранилище табов,old,archive").split(",")
)


def _newest_tab(d: str) -> str | None:
    cands = [os.path.join(d, n) for n in os.listdir(d) if not n.startswith(".") and n.lower().endswith(TAB_EXTS)]
    return max(cands, key=os.path.getmtime) if cands else None


def _write_tab(tabs_dir: str, tab_id: str, src: str, title: str, artist: str, public: bool) -> bool:
    """Copy one tab file (+ companion audio) into data/tabs/<tab_id>; returns True if the tab file changed."""
    name = os.path.basename(src)
    stem = os.path.splitext(name)[0]
    tdir = os.path.join(tabs_dir, tab_id)
    os.makedirs(tdir, exist_ok=True)
    for old in os.listdir(tdir):  # renamed/replaced tab file
        if old != name and old.lower().endswith(TAB_EXTS):
            os.remove(os.path.join(tdir, old))
    changed = _copy_if_newer(src, os.path.join(tdir, name))
    for aext in AUDIO_EXTS:  # companion audio with the same name
        asrc = os.path.join(os.path.dirname(src), stem + aext)
        if os.path.isfile(asrc) and _copy_if_newer(asrc, os.path.join(tdir, stem + aext)):
            log(f"dropbox: audio {stem}{aext} -> {tab_id}")
    cfg_path = os.path.join(tdir, "config.json")
    cfg = {"tab": {}, "audio": [], "youtube": []}
    if os.path.exists(cfg_path):
        with contextlib.suppress(Exception), open(cfg_path) as fh:
            cfg = json.load(fh)
    tab = cfg.setdefault("tab", {})
    new = {
        "id": tab_id,
        "title": tab.get("title") or title,
        "artist": tab.get("artist") or artist,
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
        with open(cfg_path, "w") as fh:
            json.dump(cfg, fh, indent=2, ensure_ascii=False)
    return changed


def import_mirror(mirror: str, tabs_dir: str, public: bool = True) -> int:
    """<root>/<Song>.gp            -> tab db-<song>          (artist "")
    <root>/<Band>/<Song>.gp     -> tab db-<band>-<song>   (artist Band)
    <root>/<Band>/<Song>/*.gp   -> tab db-<band>-<song>   newest file in the folder (working versions)
    folders named in TABRENDER_DROPBOX_IGNORE (misc, archives) are skipped."""
    changed = 0

    def do(src: str, tab_id: str, title: str, artist: str) -> None:
        nonlocal changed
        if _write_tab(tabs_dir, tab_id, src, title, artist, public):
            changed += 1
            log(f"dropbox: imported {os.path.relpath(src, mirror)} -> {tab_id}")

    def files(d: str):
        return sorted(n for n in os.listdir(d) if not n.startswith(".") and n.lower().endswith(TAB_EXTS))

    def subdirs(d: str):
        return sorted(
            n
            for n in os.listdir(d)
            if not n.startswith(".") and os.path.isdir(os.path.join(d, n)) and n.lower() not in IGNORE_DIRS
        )

    for name in files(mirror):
        stem, ext = os.path.splitext(name)
        do(
            os.path.join(mirror, name),
            ID_PREFIX + slug(stem) + ("" if ext.lower() == ".gp" else "-" + ext.lower().lstrip(".")),
            stem,
            "",
        )
    for band in subdirs(mirror):
        bdir = os.path.join(mirror, band)
        for name in files(bdir):
            stem, ext = os.path.splitext(name)
            do(
                os.path.join(bdir, name),
                ID_PREFIX
                + slug(band)
                + "-"
                + slug(stem)
                + ("" if ext.lower() == ".gp" else "-" + ext.lower().lstrip(".")),
                stem,
                band,
            )
        for song in subdirs(bdir):
            newest = _newest_tab(os.path.join(bdir, song))
            if newest:
                do(newest, ID_PREFIX + slug(band) + "-" + slug(song), song, band)
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
