# It's MyTabs with two small behaviour patches:
#  1. a tab opens with render.mp3 (the renderer's output) as the audio source instead of the MIDI synth,
#     unless the browser already remembers a choice;
#  2. the tab list marks tabs that have a render (backend adds `hasRender`, the list shows a headphones mark);
#  3. audio sync uses a sync point at every tempo change instead of a single one at bar 1: alphaTab keeps the
#     cursor speed of the last sync point, so with one point the cursor drifted after every tempo change;
#  4. when the audio resumes after buffering ("playing" event) the cursor is snapped back to the exact position:
#     alphaTab only animates towards the next beat and never corrects an offset until the next staff line;
#  5. an optional analytics tracker tag in index.html (ANALYTICS_SRC / ANALYTICS_ID build args).
#  6. a touch-select.js script tag in index.html, adding two-finger long-press playback-range
#     selection for touch screens (the upstream selection handles are mouse-drag only).
# BASE (build arg, e.g. /band-a) re-bases the SPA under a sub-path: API base, router history base, socket.io
# path, better-auth base, soundfont URL and index.html asset links. nginx strips the prefix (deploy/tabs.conf).
# The build fails if the upstream code changed and an anchor is gone — re-check the patches then.
FROM louislam/its-mytabs:1@sha256:2e478d3170bdbec11c9c3a6ff58fd5a2ba80c119fd78fe4b0e9f4f475b6356f8
ARG BASE=""
# Optional analytics: ANALYTICS_SRC is the tracker script URL, ANALYTICS_ID its site id (Umami-style
# data-website-id). Both empty = no tracker.
ARG ANALYTICS_SRC=""
ARG ANALYTICS_ID=""
USER root
COPY --chown=deno:deno touch-select.js /app/dist/touch-select.js
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
    sed -i 's#y("div",bC,_e(e.tab.title),1)#y("div",bC,_e(e.tab.title)+(e.tab.hasRender?" 🎧":""),1)#' "$i"; \
    rm -f "$i.gz"; gzip -k -9 "$i"; chown deno:deno "$i" "$i.gz"; \
    b=/app/backend/tab.ts; \
    grep -q '            tabs.push(tab);' "$b"; \
    sed -i 's#            tabs.push(tab);#            Object.assign(tab, { hasRender: await fs.exists(path.join(tabDir, id, "render.mp3")) });\n            tabs.push(tab);#' "$b"; \
    grep -q hasRender "$b"; \
    if [ -n "$BASE" ]; then \
      grep -q 'function sC(){return""}' "$i"; sed -i "s#function sC(){return\"\"}#function sC(){return\"$BASE\"}#" "$i"; \
      grep -q 'history:rk()' "$i"; sed -i "s#history:rk()#history:rk(\"$BASE\")#" "$i"; \
      grep -q 'zo(He,{query:{clientType:"tabPlayer"}' "$i"; sed -i 's#zo(He,{query:{clientType:"tabPlayer"}#zo("",{path:He+"/socket.io",query:{clientType:"tabPlayer"}#' "$i"; \
      grep -q 'eE({baseURL:He})' "$i"; sed -i 's#eE({baseURL:He})#eE({baseURL:location.origin+He+"/api/auth"})#' "$i"; \
      ! grep -q 'fetch("/api' "$i"; ! grep -q 'fetch(`/api' "$i"; \
      grep -q 'soundFont:"/soundfont/sonivox.sf2"' "$f"; sed -i 's#soundFont:"/soundfont/sonivox.sf2"#soundFont:Se+"/soundfont/sonivox.sf2"#' "$f"; \
      h=/app/dist/index.html; \
      sed -i "s#src=\"/assets/#src=\"$BASE/assets/#g; s#href=\"/assets/#href=\"$BASE/assets/#g; s#href=\"/favicon.ico\"#href=\"$BASE/favicon.ico\"#; s#<head>#<head><script>window.__BASE=\"$BASE\"</script>#" "$h"; \
      grep -q "$BASE/assets/" "$h"; \
      for x in "$f" "$i"; do rm -f "$x.gz"; gzip -k -9 "$x"; chown deno:deno "$x" "$x.gz"; done; \
    fi; \
    h=/app/dist/index.html; \
    grep -q '</head>' "$h"; \
    sed -i "s#</head>#<script defer src=\"$BASE/touch-select.js\"></script></head>#" "$h"; \
    grep -q 'touch-select.js' "$h"; \
    if [ -n "$ANALYTICS_ID" ]; then \
      h=/app/dist/index.html; \
      sed -i "s#</head>#<script defer src=\"$ANALYTICS_SRC\" data-website-id=\"$ANALYTICS_ID\"></script></head>#" "$h"; \
      grep -q "$ANALYTICS_ID" "$h"; \
    fi
