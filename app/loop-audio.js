"use strict"

// Range/loop playback of the render.mp3 backing track through an AudioWorklet instead of the <audio> element directly, so range looping can restart sample-accurately instead of through the element's seek+play round trip (see loop-fix.js for the symptom this replaces). This file wires the plumbing only: decoding render.mp3 into PCM, feeding it to loop-audio-worklet.js, and intercepting alphaTab's external-media output handler so play/pause/seek/volume/rate go to the worklet while it is engaged. Variable-rate time-stretching (WSOLA) is implemented in loop-audio-worklet.js; the debug object is window.__loopAudio below. At rate 1 the worklet is a plain passthrough.
//
// Module state, grouped below: the AudioContext/AudioWorkletNode engine itself; the decoded backing-track buffer (sample rate, frame count, cache key, and decode/size stats kept for a later commit's debug object); the loop range mirrored from alphaTab and pushed to the worklet; position-reporting bookkeeping; the watched <audio class="player"> element; and the watchdog's "last seen api/output" trackers, which only reinstall interception on a genuine change. oxfmt (0.2.0) hoists any comment placed directly before a variable declaration or as the sole content of a block out of its enclosing function, so this file keeps explanatory comments here in the header instead of inline.
//
// Switching the audio source away from render.mp3 (to the Synth) replaces alphaTab's player output without ever calling the proxy's own `pause()` — alphaTab just stops sending it work — so an engaged worklet kept rendering the backing track underneath the new synth output. The watchdog now stops the engine itself (the same worklet-pause + element-position mirroring `pause()` does, but without touching the old output's `raw.pause()`, which may already be torn down) whenever it notices the mode, player output, or api object has moved on while the engine was still active. The proxy's own `pause()` wraps its `raw.pause()` call for the same reason: it can be invoked mid-switch, after alphaTab has already started discarding the output it belongs to.
;(function () {
  const EXTERNAL_MEDIA = 4
  let ctx = null
  let node = null
  let gain = null
  let ctxPromise = null
  let engineAvailable = true
  let engineActive = false
  let rate = 1
  let sampleRate = 0
  let bufferLengthFrames = 0
  let cacheKey = null
  let decodeGeneration = 0
  let decodeMs = 0
  let bufferMB = 0
  let wrapCount = 0
  let lastWrapMs = null
  let L0 = 0
  let L1 = 0
  let looping = false
  let lastPostedRange = null
  let lastReportedMs = 0
  let lastFrame = null
  let el = null
  let lastSeenSrc = null
  let lastSeenApi = null
  let lastSeenOutput = null
  let rangeSubscribedApi = null
  let currentOutput = null
  let currentProtoUpdatePosition = null
  let stretchSeq = 40
  let stretchOvl = 12
  let stretchSeek = 8

  function validStretch(seq, ovl, seek) {
    return (
      Number.isFinite(seq) &&
      Number.isFinite(ovl) &&
      Number.isFinite(seek) &&
      seq >= 10 &&
      seq <= 100 &&
      ovl >= 2 &&
      ovl <= 40 &&
      ovl < seq / 2 &&
      seek >= 1 &&
      seek <= 30
    )
  }

  function applyStretch(seq, ovl, seek) {
    if (!validStretch(seq, ovl, seek)) return false
    stretchSeq = seq
    stretchOvl = ovl
    stretchSeek = seek
    if (node) node.port.postMessage({ type: "tune", seq, ovl, seek })
    return true
  }

  function readStretchParam() {
    const raw = new URLSearchParams(location.search).get("stretch")
    if (!raw) return
    const parts = raw.split(",").map(Number)
    if (parts.length !== 3 || !validStretch(parts[0], parts[1], parts[2])) {
      console.warn("loop-audio: ignoring invalid ?stretch param", raw)
      return
    }
    applyStretch(parts[0], parts[1], parts[2])
  }

  function floatToInt16(sample) {
    return Math.max(-32768, Math.min(32767, Math.round(sample * 32768)))
  }

  function convertToPcm(decoded) {
    const decodedSampleRate = decoded.sampleRate
    const length = decoded.length
    const chL = new Int16Array(length)
    const scratch = new Float32Array(decodedSampleRate)
    for (let offset = 0; offset < length; offset += decodedSampleRate) {
      const count = Math.min(decodedSampleRate, length - offset)
      decoded.copyFromChannel(scratch, 0, offset)
      for (let index = 0; index < count; index++) {
        chL[offset + index] = floatToInt16(scratch[index])
      }
    }
    return { chL, chR: chL.slice() }
  }

  function audioMs(apiTick) {
    const api = window.api
    if (!api || !api.player) return null
    try {
      const player = api.player
      const seq = (player.instance || player._instance).sequencer
      const timeMs = seq.mainTickPositionToTimePosition(
        apiTick + player.midiTickShift,
      )
      return seq.mainTimePositionToBackingTrack(
        timeMs,
        player.output.backingTrackDuration,
      )
    } catch {
      return null
    }
  }

  function ensureCtx() {
    if (!engineAvailable)
      return Promise.reject(new Error("loop-audio: engine unavailable"))
    if (ctxPromise) return ctxPromise
    ctxPromise = (async () => {
      try {
        ctx = new AudioContext({ sampleRate: 44100 })
        await ctx.audioWorklet.addModule(
          (window.__BASE || "") + "/loop-audio-worklet.js",
        )
        node = new AudioWorkletNode(ctx, "loop-audio", {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        })
        gain = ctx.createGain()
        node.connect(gain).connect(ctx.destination)
        node.port.onmessage = handleWorkletMessage
        node.port.postMessage({
          type: "tune",
          seq: stretchSeq,
          ovl: stretchOvl,
          seek: stretchSeek,
        })
      } catch (error) {
        engineAvailable = false
        throw error
      }
    })()
    return ctxPromise
  }

  function resetEngine() {
    if (ctx) {
      try {
        ctx.close()
      } catch {}
    }
    ctx = null
    node = null
    gain = null
    ctxPromise = null
    cacheKey = null
    bufferLengthFrames = 0
    sampleRate = 0
    engineActive = false
    lastPostedRange = null
    decodeGeneration++
  }

  async function decodeAndCache(sourceEl, src) {
    const generation = decodeGeneration
    try {
      await ensureCtx()
    } catch {
      return
    }
    if (generation !== decodeGeneration) return

    const startedAt = performance.now()
    let arrayBuffer
    try {
      arrayBuffer = await (await fetch(src)).arrayBuffer()
    } catch (error) {
      console.error("loop-audio: failed to fetch backing track", error)
      return
    }
    if (generation !== decodeGeneration || sourceEl.currentSrc !== src) return

    let decoded
    try {
      decoded = await ctx.decodeAudioData(arrayBuffer)
    } catch (error) {
      console.error("loop-audio: failed to decode backing track", error)
      return
    }
    if (generation !== decodeGeneration || sourceEl.currentSrc !== src) return
    if (decoded.duration > 600) return

    const { chL, chR } = convertToPcm(decoded)
    bufferMB = (chL.buffer.byteLength + chR.buffer.byteLength) / (1024 * 1024)
    decodeMs = performance.now() - startedAt
    sampleRate = decoded.sampleRate
    bufferLengthFrames = decoded.length
    cacheKey = src
    node.port.postMessage({ type: "buffer", chL, chR, sampleRate }, [
      chL.buffer,
      chR.buffer,
    ])
  }

  function handleNewSrc(src) {
    resetEngine()
    if (!src.includes("/api/tab/")) return
    decodeAndCache(el, src)
  }

  function checkSrcChange() {
    const found = document.querySelector("audio.player")
    if (!found) return
    el = found
    const src = el.currentSrc
    if (!src || src === lastSeenSrc) return
    lastSeenSrc = src
    handleNewSrc(src)
  }

  function shouldEngage(raw) {
    if (!engineAvailable || !node || !el) return false
    if (cacheKey === null || cacheKey !== el.currentSrc) return false
    return Math.abs(raw.backingTrackDuration - el.duration * 1000) < 1
  }

  function makeProxyHandler(raw) {
    return {
      get backingTrackDuration() {
        return raw.backingTrackDuration
      },
      get masterVolume() {
        return raw.masterVolume
      },
      set masterVolume(value) {
        if (gain) gain.gain.setTargetAtTime(value, ctx.currentTime, 0.01)
        raw.masterVolume = value
      },
      get playbackRate() {
        return rate
      },
      set playbackRate(value) {
        rate = value
        if (node) node.port.postMessage({ type: "rate", rate: value })
        raw.playbackRate = value
      },
      seekTo(ms) {
        if (engineActive && Math.abs(ms - lastReportedMs) < 25) return
        let frame = Math.round((ms / 1000) * sampleRate)
        if (looping && frame > L1) {
          const len = L1 - L0
          frame = len > 0 ? L0 + ((((frame - L0) % len) + len) % len) : L0
        }
        if (node) node.port.postMessage({ type: "seek", frame })
        if (!engineActive) raw.seekTo(ms)
      },
      play() {
        if (shouldEngage(raw)) {
          ctx.resume()
          node.port.postMessage({ type: "play" })
          engineActive = true
        } else {
          raw.play()
          engineActive = false
        }
      },
      pause() {
        if (node) node.port.postMessage({ type: "pause" })
        if (el && sampleRate) {
          const frame =
            lastFrame !== null ? lastFrame : el.currentTime * sampleRate
          el.currentTime = frame / sampleRate
        }
        try {
          raw.pause()
        } catch (error) {
          console.warn("loop-audio: pause during mode switch failed", error)
        }
        engineActive = false
      },
    }
  }

  function stopEngine() {
    if (node) node.port.postMessage({ type: "pause" })
    if (el && sampleRate) {
      const frame = lastFrame !== null ? lastFrame : el.currentTime * sampleRate
      el.currentTime = frame / sampleRate
    }
    engineActive = false
  }

  function interceptOutput(output) {
    const proto = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(output),
      "handler",
    )
    let raw = proto.get ? proto.get.call(output) : null
    Object.defineProperty(output, "handler", {
      configurable: true,
      get() {
        return proto.get.call(output)
      },
      set(value) {
        raw = value
        proto.set.call(output, makeProxyHandler(raw))
      },
    })
    if (raw) {
      proto.set.call(output, makeProxyHandler(raw))
    }

    currentOutput = output
    currentProtoUpdatePosition = Object.getPrototypeOf(output).updatePosition
    const protoUpdatePosition = currentProtoUpdatePosition
    output.updatePosition = function (ms) {
      if (engineActive) return
      protoUpdatePosition.call(output, ms)
    }
  }

  function syncRange(api) {
    if (!node || !sampleRate) return
    const range = api.playbackRange
    const startMs = range ? audioMs(range.startTick) : 0
    const endMs = range ? audioMs(range.endTick) : 0
    if (range && (startMs === null || endMs === null)) return
    const newL0 = range ? Math.round((startMs / 1000) * sampleRate) : 0
    const newL1 = range
      ? Math.round((endMs / 1000) * sampleRate)
      : bufferLengthFrames
    const newLooping = api.isLooping && !!range
    if (
      lastPostedRange &&
      lastPostedRange.L0 === newL0 &&
      lastPostedRange.L1 === newL1 &&
      lastPostedRange.looping === newLooping
    )
      return
    L0 = newL0
    L1 = newL1
    looping = newLooping
    lastPostedRange = { L0: newL0, L1: newL1, looping: newLooping }
    node.port.postMessage({ type: "range", L0, L1, looping })
  }

  function handleWorkletMessage(event) {
    const { data } = event
    if (data.type === "pos") {
      const ms = (data.frame / sampleRate) * 1000
      const endMs = (L1 / sampleRate) * 1000
      const reportedMs = looping ? Math.min(ms, endMs - 15) : ms
      if (currentOutput && currentProtoUpdatePosition)
        currentProtoUpdatePosition.call(currentOutput, reportedMs)
      if (lastFrame !== null && data.frame < lastFrame && el) {
        el.dispatchEvent(new Event("playing"))
        wrapCount++
        lastWrapMs = Date.now()
      }
      lastReportedMs = reportedMs
      lastFrame = data.frame
    } else if (data.type === "ended") {
      const endMs = (L1 / sampleRate) * 1000
      if (currentOutput && currentProtoUpdatePosition)
        currentProtoUpdatePosition.call(currentOutput, endMs)
    }
  }

  function watchdogTick() {
    checkSrcChange()

    const api = window.api
    const mode =
      api &&
      (api.actualPlayerMode !== undefined
        ? api.actualPlayerMode
        : api.settings.player.playerMode)
    const output = api && api.player && api.player.output

    if (
      engineActive &&
      (mode !== EXTERNAL_MEDIA ||
        output !== currentOutput ||
        api !== lastSeenApi)
    ) {
      stopEngine()
    }

    if (!api) return
    if (mode !== EXTERNAL_MEDIA) return
    if (!output) return

    if (api !== lastSeenApi || output !== lastSeenOutput) {
      interceptOutput(output)
      lastSeenApi = api
      lastSeenOutput = output
    }

    if (api !== rangeSubscribedApi) {
      api.playbackRangeChanged.on(() => syncRange(api))
      rangeSubscribedApi = api
    }

    syncRange(api)
  }

  setInterval(watchdogTick, 500)
  window.addEventListener("pagehide", resetEngine)

  document.addEventListener(
    "pointerdown",
    () => {
      if (ctx) ctx.resume()
    },
    { once: true, capture: true },
  )
  document.addEventListener("visibilitychange", () => {
    if (ctx && engineActive) ctx.resume()
  })

  window.__loopAudio = {
    get state() {
      if (!engineAvailable) return "unavailable"
      if (engineActive) return "engine"
      return "fallback"
    },
    get engineActive() {
      return engineActive
    },
    get wraps() {
      return wrapCount
    },
    get lastWrapMs() {
      return lastWrapMs
    },
    get decodeMs() {
      return decodeMs
    },
    get bufferMB() {
      return bufferMB
    },
    get stretch() {
      return { seq: stretchSeq, ovl: stretchOvl, seek: stretchSeek }
    },
    tune(seq, ovl, seek) {
      return applyStretch(seq, ovl, seek)
    },
  }

  readStretchParam()
})()
