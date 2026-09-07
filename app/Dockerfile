# It's MyTabs with two small behaviour patches:
#  1. a tab opens with render.mp3 (the renderer's output) as the audio source instead of the MIDI synth,
#     unless the browser already remembers a choice;
#  2. the tab list marks tabs that have a render (backend adds `hasRender`, the list gives the title a
#     `has-render` class; mobile-ui.js paints the mark, a small masked icon, from that class);
#  3. audio sync uses a sync point at every tempo change instead of a single one at bar 1: alphaTab keeps the
#     cursor speed of the last sync point, so with one point the cursor drifted after every tempo change;
#  4. when the audio resumes after buffering ("playing" event) the cursor is snapped back to the exact position:
#     alphaTab only animates towards the next beat and never corrects an offset until the next staff line;
#  5. an optional analytics tracker tag in index.html (ANALYTICS_SRC / ANALYTICS_ID build args);
#  6. a touch-select.js script tag in index.html, adding two-finger long-press playback-range
#     selection for touch screens (the upstream selection handles are mouse-drag only);
#  7. loop-fix.js: restarts a looped playback range correctly with an external audio file (alphaTab
#     seeks one bar late and pauses there);
#  8. loop-audio.js + loop-audio-worklet.js: a gapless, pitch-preserving loop engine. It intercepts
#     alphaTab's external-media output handler and plays the decoded render.mp3 through an
#     AudioWorklet (crossfaded seam at normal speed, WSOLA time-stretch below it). It engages once the
#     current source is decoded and falls back to the <audio> element (and loop-fix.js) otherwise:
#     YouTube audio, decode failure, tabs longer than 10 minutes. The WSOLA window sizes are tunable
#     at runtime via the `?stretch=seq,ovl,seek` URL param (ms) or `window.__loopAudio.tune(...)`;
#  9. Cache-Control (10 min) on the tab audio endpoint, so the engine's fetch reuses the element's
#     download of render.mp3;
#  10. mobile-ui.js: phone layout for the bottom toolbar below a max-width of 640px, wrapping it
#      into rows; Play/Loop/Count in/Metronome as icon-only buttons at every width (hand-drawn
#      stroke icons, Play morphing between a triangle and pause bars, active state shown as a
#      filled background); a split speed control (percentage toggle plus a caret opening a
#      slider/number menu) replacing the upstream number input; Solo/Mute in the track sheet
#      driven by the addon itself (multiple solos at once, audible only with the Synth audio
#      source); the volume knob resets to 100% on a double-tap; a per-track instrument icon
#      (game-icons.net SVG set) on the track selector button and track/audio list rows; and the
#      tab list's render mark (see patch 2);
#  11. play-ready.js: retries a Play press that lands during the synth's soundfont fetch, since
#      api.play() is a silent no-op while the synth is not ready and the toolbar button never
#      recovers on its own; Cache-Control (7 days) on the soundfont endpoint so repeat switches to
#      Synth don't re-download it.
# The start task runs with --cached-only: the image ships no deno.lock, so a plain start re-resolves npm
# dependencies against the registry and hung when a newer hono was published; the cached tree is complete.
# The preview soundfont is the bundled sonivox.sf2 with its guitar/bass instruments patched by
# soundfont/sf2envelope.py: upstream's envelopes fade every note to silence 70 ms after the attack. Its URL in
# the player carries the file's checksum, so a changed bank gets past the week-long browser cache.
# BASE (build arg, e.g. /band-a) re-bases the SPA under a sub-path: API base, router history base, socket.io
# path, better-auth base, soundfont URL and index.html asset links. nginx strips the prefix (deploy/tabs.conf).
# The build fails if the upstream code changed and an anchor is gone — re-check the patches then.
FROM louislam/its-mytabs:1@sha256:2e478d3170bdbec11c9c3a6ff58fd5a2ba80c119fd78fe4b0e9f4f475b6356f8
ARG BASE=""
# Optional analytics: ANALYTICS_SRC is the tracker script URL, ANALYTICS_ID its site id (Umami-style
# data-website-id). Both empty = no tracker.
ARG ANALYTICS_SRC=""
ARG ANALYTICS_ID=""
# The upstream entrypoint drops to the deno user itself; root is needed to patch /app.
# hadolint ignore=DL3002,DL3066
USER root
COPY --chown=deno:deno touch-select.js /app/dist/touch-select.js
COPY --chown=deno:deno loop-fix.js /app/dist/loop-fix.js
COPY --chown=deno:deno loop-audio.js /app/dist/loop-audio.js
COPY --chown=deno:deno loop-audio-worklet.js /app/dist/loop-audio-worklet.js
COPY --chown=deno:deno mobile-ui.js /app/dist/mobile-ui.js
COPY --chown=deno:deno play-ready.js /app/dist/play-ready.js
# sonivox.sf2 = the image's own GM bank with guitar/bass volume envelopes fixed by soundfont/sf2envelope.py
COPY --chown=deno:deno sonivox.sf2 /app/dist/soundfont/sonivox.sf2
# The entrypoint expects the image WORKDIR (/app) unchanged, so the patch step cd's inside the RUN.
# hadolint ignore=DL3003
RUN set -eu; cd /app/dist/assets; f=$(ls Tab-*.js); \
    grep -q 'this.currentAudio=this.getConfig("audio","synth")' "$f"; \
    sed -i 's#this.currentAudio=this.getConfig("audio","synth")#this.currentAudio=this.getConfig("audio",this.audioList.some(o=>o.filename==="render.mp3")?"audio-render.mp3":"synth")#' "$f"; \
    grep -q 'audio-render.mp3' "$f"; \
    grep -q 'simpleSync(e){const t=\[{barIndex:0,barOccurence:0,barPosition:0,millisecondOffset:e}\];this.api.score.applyFlatSyncPoints(t)}' "$f"; \
    sed -i 's#simpleSync(e){const t=\[{barIndex:0,barOccurence:0,barPosition:0,millisecondOffset:e}\];this.api.score.applyFlatSyncPoints(t)}#simpleSync(e){const S=this.api.score,G=R.midi.MidiFileGenerator.generateSyncPoints(S,!0),t=[];for(let i=0;i<G.length;i++){const p=G[i],mb=S.masterBars[p.masterBarIndex];let r=0;if(i===G.length-1)r=1;else if(i>0){const a=(mb.tempoAutomations||[]).find(x=>x.value===p.synthBpm);r=a?a.ratioPosition:0}t.push({barIndex:p.masterBarIndex,barOccurence:Math.max(0,p.masterBarOccurence),barPosition:r,millisecondOffset:p.synthTime+e})}S.applyFlatSyncPoints(t);this.api.updateSyncPoints()}#' "$f"; \
    grep -q 'generateSyncPoints' "$f"; \
    grep -q 't.addEventListener("timeupdate",l),t.addEventListener("seeked",l)' "$f"; \
    sed -i 's#t.addEventListener("timeupdate",l),t.addEventListener("seeked",l)#t.addEventListener("timeupdate",l),t.addEventListener("seeked",l),t.addEventListener("playing",()=>{const a=this.api;if(a\&\&a._cursorUpdateTick){a._isInitialBeatCursorUpdate=!0;a._cursorUpdateTick(a.tickPosition,!1,1,!1,!0)}})#' "$f"; \
    grep -q '_isInitialBeatCursorUpdate=!0' "$f"; \
    rm -f "$f.gz"; gzip -k -9 "$f"; chown deno:deno "$f" "$f.gz"; \
    i=$(ls index-*.js); \
    grep -q 'y("div",bC,_e(e.tab.title),1)' "$i"; \
    sed -i 's#y("div",bC,_e(e.tab.title),1)#y("div",{class:e.tab.hasRender?"title has-render":"title"},_e(e.tab.title),3)#' "$i"; \
    grep -q 'has-render' "$i"; \
    rm -f "$i.gz"; gzip -k -9 "$i"; chown deno:deno "$i" "$i.gz"; \
    b=/app/backend/tab.ts; \
    grep -q '            tabs.push(tab);' "$b"; \
    sed -i 's#            tabs.push(tab);#            Object.assign(tab, { hasRender: await fs.exists(path.join(tabDir, id, "render.mp3")) });\n            tabs.push(tab);#' "$b"; \
    grep -q hasRender "$b"; \
    j=/app/deno.jsonc; \
    grep -q '"start": "deno run --allow-all backend/main.ts",' "$j"; \
    sed -i 's#"start": "deno run --allow-all backend/main.ts",#"start": "deno run --allow-all --cached-only backend/main.ts",#' "$j"; \
    grep -q 'cached-only' "$j"; \
    m=/app/backend/main.ts; \
    grep -q '                "Accept-Ranges": "bytes",' "$m"; \
    sed -i 's#                "Accept-Ranges": "bytes",#                "Accept-Ranges": "bytes",\n                "Cache-Control": "private, max-age=600",#' "$m"; \
    grep -q 'Cache-Control' "$m"; \
    grep -q '    app.get("/", (c) => {' "$m"; \
    sed -i 's#    app.get("/", (c) => {#    app.use("/soundfont/*", async (c, next) => { await next(); c.res.headers.set("Cache-Control", "public, max-age=604800"); });\n    app.get("/", (c) => {#' "$m"; \
    grep -q 'max-age=604800' "$m"; \
    if [ -n "$BASE" ]; then \
      grep -q 'function sC(){return""}' "$i"; sed -i "s#function sC(){return\"\"}#function sC(){return\"$BASE\"}#" "$i"; \
      grep -q 'history:rk()' "$i"; sed -i "s#history:rk()#history:rk(\"$BASE\")#" "$i"; \
      grep -q 'zo(He,{query:{clientType:"tabPlayer"}' "$i"; sed -i 's#zo(He,{query:{clientType:"tabPlayer"}#zo("",{path:He+"/socket.io",query:{clientType:"tabPlayer"}#' "$i"; \
      grep -q 'eE({baseURL:He})' "$i"; sed -i 's#eE({baseURL:He})#eE({baseURL:location.origin+He+"/api/auth"})#' "$i"; \
      if grep -q 'fetch("/api' "$i" || grep -q 'fetch(`/api' "$i"; then echo "unrebased API call left"; exit 1; fi; \
      h=/app/dist/index.html; \
      sed -i "s#src=\"/assets/#src=\"$BASE/assets/#g; s#href=\"/assets/#href=\"$BASE/assets/#g; s#href=\"/favicon.ico\"#href=\"$BASE/favicon.ico\"#; s#<head>#<head><script>window.__BASE=\"$BASE\"</script>#" "$h"; \
      grep -q "$BASE/assets/" "$h"; \
      for x in "$f" "$i"; do rm -f "$x.gz"; gzip -k -9 "$x"; chown deno:deno "$x" "$x.gz"; done; \
    fi; \
    sfv=$(md5sum /app/dist/soundfont/sonivox.sf2); sfv=$(printf '%.8s' "$sfv"); \
    grep -q 'soundFont:"/soundfont/sonivox.sf2"' "$f"; \
    sed -i "s#soundFont:\"/soundfont/sonivox.sf2\"#soundFont:(window.__BASE||\"\")+\"/soundfont/sonivox.sf2?v=$sfv\"#" "$f"; \
    grep -q "sonivox.sf2?v=$sfv" "$f"; \
    rm -f "$f.gz"; gzip -k -9 "$f"; chown deno:deno "$f" "$f.gz"; \
    h=/app/dist/index.html; \
    grep -q '</head>' "$h"; \
    sed -i "s#</head>#<script defer src=\"$BASE/touch-select.js\"></script></head>#" "$h"; \
    grep -q 'touch-select.js' "$h"; \
    sed -i "s#</head>#<script defer src=\"$BASE/loop-fix.js\"></script></head>#" "$h"; \
    grep -q 'loop-fix.js' "$h"; \
    sed -i "s#</head>#<script defer src=\"$BASE/loop-audio.js\"></script></head>#" "$h"; \
    grep -q 'loop-audio.js' "$h"; \
    sed -i "s#</head>#<script defer src=\"$BASE/mobile-ui.js\"></script></head>#" "$h"; \
    grep -q 'mobile-ui.js' "$h"; \
    sed -i "s#</head>#<script defer src=\"$BASE/play-ready.js\"></script></head>#" "$h"; \
    grep -q 'play-ready.js' "$h"; \
    if [ -n "$ANALYTICS_ID" ]; then \
      h=/app/dist/index.html; \
      sed -i "s#</head>#<script defer src=\"$ANALYTICS_SRC\" data-website-id=\"$ANALYTICS_ID\"></script></head>#" "$h"; \
      grep -q "$ANALYTICS_ID" "$h"; \
    fi
