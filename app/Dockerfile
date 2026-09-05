# It's MyTabs with one behaviour patch on the built frontend: a tab opens with render.mp3 (the renderer's
# output) as the audio source instead of the MIDI synth, unless the browser already remembers a choice.
# The build fails if the upstream code changed and the anchor is gone — re-check the patch then.
FROM louislam/its-mytabs:1@sha256:2e478d3170bdbec11c9c3a6ff58fd5a2ba80c119fd78fe4b0e9f4f475b6356f8
USER root
RUN set -eu; cd /app/dist/assets; f=$(ls Tab-*.js); \
    grep -q 'this.currentAudio=this.getConfig("audio","synth")' "$f"; \
    sed -i 's#this.currentAudio=this.getConfig("audio","synth")#this.currentAudio=this.getConfig("audio",this.audioList.some(o=>o.filename==="render.mp3")?"audio-render.mp3":"synth")#' "$f"; \
    grep -q 'audio-render.mp3' "$f"; \
    rm -f "$f.gz"; gzip -k -9 "$f"; chown deno:deno "$f" "$f.gz"
