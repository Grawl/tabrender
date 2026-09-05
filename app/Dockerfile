# It's MyTabs with two small behaviour patches:
#  1. a tab opens with render.mp3 (the renderer's output) as the audio source instead of the MIDI synth,
#     unless the browser already remembers a choice;
#  2. the tab list marks tabs that have a render (backend adds `hasRender`, the list shows a headphones mark).
# The build fails if the upstream code changed and an anchor is gone — re-check the patches then.
FROM louislam/its-mytabs:1@sha256:2e478d3170bdbec11c9c3a6ff58fd5a2ba80c119fd78fe4b0e9f4f475b6356f8
USER root
RUN set -eu; cd /app/dist/assets; f=$(ls Tab-*.js); \
    grep -q 'this.currentAudio=this.getConfig("audio","synth")' "$f"; \
    sed -i 's#this.currentAudio=this.getConfig("audio","synth")#this.currentAudio=this.getConfig("audio",this.audioList.some(o=>o.filename==="render.mp3")?"audio-render.mp3":"synth")#' "$f"; \
    grep -q 'audio-render.mp3' "$f"; \
    rm -f "$f.gz"; gzip -k -9 "$f"; chown deno:deno "$f" "$f.gz"; \
    i=$(ls index-*.js); \
    grep -q 'y("div",bC,_e(e.tab.title),1)' "$i"; \
    sed -i 's#y("div",bC,_e(e.tab.title),1)#y("div",bC,_e(e.tab.title)+(e.tab.hasRender?" 🎧":""),1)#' "$i"; \
    rm -f "$i.gz"; gzip -k -9 "$i"; chown deno:deno "$i" "$i.gz"; \
    b=/app/backend/tab.ts; \
    grep -q '            tabs.push(tab);' "$b"; \
    sed -i 's#            tabs.push(tab);#            Object.assign(tab, { hasRender: await fs.exists(path.join(tabDir, id, "render.mp3")) });\n            tabs.push(tab);#' "$b"; \
    grep -q hasRender "$b"
