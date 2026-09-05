# tabs

Self-hosted Guitar Pro player for sharing tabs with the bands: [It's MyTabs](https://github.com/louislam/its-mytabs)
plus a renderer that turns every tab into an MP3 with sampled guitars, amp captures and a real drum kit
(see [render/README.md](render/README.md)). Tabs arrive from a Dropbox folder.

- `compose.yaml` — player + renderer; `compose.server.yaml` adds the reverse-proxy network for tabs.example.com.
- `deploy/tabs.conf` — nginx vhost for the jonasal/nginx-certbot container on the home server.
- `soundfont/` — GM soundfont for the in-browser MIDI preview; `sf2mono.py` patches stereo samples to mono because
  alphaTab's synth drops them (presets go silent).
- `sf-compare/` — local A/B page for soundfonts (diagnostic).
