FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends fluidsynth ffmpeg nodejs npm rclone \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir numpy scipy soundfile mido \
    # neural-amp-modeler without its training stack (transformers, tensorboard, librosa...): only what the
    # model loader imports at runtime
    && pip install --no-cache-dir --no-deps neural-amp-modeler==0.12.3 \
    && pip install --no-cache-dir wavio tqdm pydantic
COPY gp2midi.mjs ./
COPY tabrender ./tabrender
ENV TABRENDER_ASSETS=/assets TABRENDER_SOUNDFONT=/assets/FluidR3_GM_mono.sf2 OMP_NUM_THREADS=4 PYTHONUNBUFFERED=1
CMD ["python", "-m", "tabrender.watch", "/data/tabs"]
