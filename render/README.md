# tabrender

Renders Guitar Pro tabs from It's MyTabs (`data/tabs/<id>/*.gp*`) to `render.mp3` next to the tab file.
It's MyTabs lists every audio file in a tab folder, so the render shows up as a synced audio track
(offset 0) without touching its API.

Pipeline per tab:

1. `gp2midi.mjs` — alphaTab (Node) converts the score to SMF1 MIDI plus a JSON with track/channel
   mapping and per-note articulations (palm mute, dead notes...) that MIDI cannot carry.
2. Guitar tracks (GM programs 24–31) — `tabrender/sampler.py`, a small one-shot SFZ sampler over the free
   Unreal Instruments DI libraries (Metal GTX for distortion, Standard Guitar for clean), with pitch bends
   applied through time-varying resampling. Palm-muted notes use the `Mute_Down` articulation.
3. Amp — `tabrender/amp.py` runs Neural Amp Modeler captures (`.nam`, WaveNet) or GuitarML Proteus LSTM
   captures (`.json`) in torch (CPU); NAM audio is resampled to the capture rate (48 kHz) around the model.
4. Cabinet — `tabrender/cab.py` convolves with an impulse response (`assets/ir/*.wav`).
5. Drums — the same sampler over the Salamander Drumkit (SFZ, real cymbals) plus a synthetic sub layer under kicks.
6. Bass and keys — FluidSynth with the shared FluidR3 GM soundfont.
7. Mix with the track volume/pan from the file, normalise, encode MP3 with ffmpeg.

`tabrender/watch.py` polls the tabs folder, keeps `.render.json` (hash + version) per tab and re-renders when
the tab file changes. Bump `VERSION` there to force a re-render after pipeline changes.

## Assets

NAM captures (`assets/amps/nam/*.nam`) come from tone3000.com via `./download-tone3000.sh`, which needs the
account Secret Key in `.tone3000-key` (gitignored). Full-rig captures include the cabinet, so no IR is applied.

`./download-assets.sh` fetches ~2.5 GB of free assets into `assets/` (gitignored): Unreal Instruments SFZ
libraries (Google Drive, via `gdown`), GuitarML ToneLibrary amp captures (GPL-3.0), cabinet IRs.

## Run

```bash
docker compose up -d --build render
docker compose logs -f render
```

Local dev: `python -m tabrender.render path/to/tab.gp out.mp3` (needs node + `npm install`, fluidsynth, ffmpeg,
and the Python deps from the Dockerfile).

## Dropbox

`tabrender/dropbox_import.py` mirrors a Dropbox folder with rclone on every watcher tick and imports
`<Band>/<Song>.gp*` as tab `db-<band>-<song>` (title = file name, artist = band folder, public by default).
A song folder inside a band folder (`<Band>/<Song>/*.gp`, dated working versions) becomes one tab from its newest
file; folders named in `TABRENDER_DROPBOX_IGNORE` (misc, archives) are skipped. Re-uploading a file updates the tab
and triggers a re-render; deleting in Dropbox leaves the tab in place.

Setup: `rclone authorize "dropbox"` on a machine with a browser, put the resulting token into
`../rclone/rclone.conf` as remote `[dropbox]` (`type = dropbox`, `token = {...}`), set
`TABRENDER_DROPBOX_REMOTE` in compose (`dropbox:<folder>`).
