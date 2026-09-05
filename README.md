# tabrender

Self-hosted Guitar Pro player for sharing tabs with the bands: [It's MyTabs](https://github.com/louislam/its-mytabs)
plus a renderer that turns every tab into an MP3 with sampled guitars, amp captures and a real drum kit
(see [render/README.md](render/README.md)). Tabs arrive from a Dropbox folder.

The renderer is the interesting part: alphaTab exports the score to MIDI plus per-note articulations (palm mute,
dead notes, bends); a small numpy SFZ sampler plays DI guitar samples with those articulations, double-tracked;
[Neural Amp Modeler](https://github.com/sdatkinson/neural-amp-modeler) captures give the amp tone; drums go through
the same sampler with a GM-to-kit map; bass gets a split-band drive. No DAW, no plugins, everything open source and
headless. The player is patched so the cursor follows the MP3 exactly even across tempo changes.

- `compose.yaml` — player + renderer; `compose.server.yaml` adds the reverse-proxy network for tabs.example.com.
- `deploy/tabs.conf` — nginx vhost for the jonasal/nginx-certbot container on the home server.
- `soundfont/` — GM soundfont for the in-browser MIDI preview; `sf2mono.py` patches stereo samples to mono because
  alphaTab's synth drops them (presets go silent).
- `sf-compare/` — local A/B page for soundfonts (diagnostic).

## What is not in git and where it comes from

| Path | What | Source |
| --- | --- | --- |
| `data/` | It's MyTabs runtime: `config.db` (account), `tabs/<id>/` (tab file, `config.json`, `render.mp3`, `.render.json`), `dropbox-mirror/` | created by the app, the renderer and the Dropbox import; back it up, never regenerate |
| `soundfont/*.sf2` | GM soundfonts for the MIDI preview | `sonivox.sf2` ships inside the `louislam/its-mytabs` image (`/app/dist/soundfont/`); `FluidR3_GM.sf2` from <https://ftp.osuosl.org/pub/musescore/soundfont/fluid-soundfont.tar.gz>, then `python3 soundfont/sf2mono.py FluidR3_GM.sf2 FluidR3_GM_mono.sf2`; `GeneralUser_GS.sf2` from <https://github.com/mrbumpy409/GeneralUser-GS> |
| `render/assets/` | DI guitar libraries, drum kit, IRs, Proteus captures | `render/download-assets.sh` (~3 GB, Google Drive + GitHub + archive.org) |
| `render/assets/amps/nam/`, `render/assets/ir/t3k/` | NAM captures and IRs from tone3000 | `render/download-tone3000.sh`, needs `render/.tone3000-key` |
| `render/.tone3000-key` | tone3000 account Secret Key | tone3000.com → Settings → API Keys |
| `rclone/rclone.conf` | Dropbox token for the import | `rclone authorize "dropbox"` on a machine with a browser, paste the token as `[dropbox] type = dropbox token = {...}` |
| `render/out/` | local render experiments | scratch |
| `sf-compare/alphatab/`, `sf-compare/sf`, `sf-compare/tabs/` | vendored alphaTab build, soundfont symlink and tab copies for the A/B page | `npm pack @coderline/alphatab@1.8.0` → `dist/`; symlink `sf -> ../soundfont`; copy tabs from `data/` |
| `node_modules/` | linters, formatter, prek | `npm install` |

## Development

`npm install` brings oxlint, oxfmt, markdownlint-cli2 and prek; ruff comes from `brew install ruff` or
`pip install ruff`. `npx prek install` enables the pre-commit hooks; `npm run lint` runs everything, `npm run format`
fixes what can be fixed. GitLab CI runs the same checks in the `lint` stage.

## License

MIT for the code in this repository. The sample libraries, amp captures and soundfonts it downloads have their
own licenses (see the download scripts).
