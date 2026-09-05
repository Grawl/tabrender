# It's MyTabs with two small behaviour patches:
#  1. a tab opens with render.mp3 (the renderer's output) as the audio source instead of the MIDI synth,
#     unless the browser already remembers a choice;
#  2. the tab list marks tabs that have a render (backend adds `hasRender`, the list shows a headphones mark).
# BASE (build arg, e.g. /band-a) re-bases the SPA under a sub-path: API base, router history base, socket.io
# path, better-auth base, soundfont URL and index.html asset links. nginx strips the prefix (deploy/tabs.conf).
# The build fails if the upstream code changed and an anchor is gone — re-check the patches then.
FROM louislam/its-mytabs:1@sha256:2e478d3170bdbec11c9c3a6ff58fd5a2ba80c119fd78fe4b0e9f4f475b6356f8
ARG BASE=""
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
    fi
