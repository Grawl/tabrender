"use strict"

// Range/loop playback of the render.mp3 backing track through an AudioWorklet instead of the
// <audio> element directly, so range looping can restart sample-accurately instead of through
// the element's seek+play round trip (see loop-fix.js for the symptom this replaces). This file
// wires the plumbing only: decoding render.mp3 into PCM, feeding it to loop-audio-worklet.js, and
// intercepting alphaTab's external-media output handler so play/pause/seek/volume/rate go to the
// worklet while it is engaged. Variable-rate time-stretching (WSOLA) and the debug object are
// added in later commits; at rate 1 the worklet is a plain passthrough.
// alphaTab.PlayerMode.EnabledExternalMedia
//
// Module state, grouped below: the AudioContext/AudioWorkletNode engine itself; the decoded
// backing-track buffer (sample rate, frame count, cache key, and decode/size stats kept for a
// later commit's debug object); the loop range mirrored from alphaTab and pushed to the worklet;
// position-reporting bookkeeping; the watched <audio class="player"> element; and the watchdog's
// "last seen api/output/handler" trackers, which only reinstall interception on a genuine change
// (comparing against the raw value tracked in `lastRawHandler`, not read back through the getter
// this file installs, which would always match). oxfmt (0.2.0) hoists any comment placed directly
// before a variable declaration or as the sole content of a block out of its enclosing function,
// so this file keeps explanatory comments here in the header instead of inline.
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
  let _decodeMs = 0
  let _bufferMB = 0
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
  let lastRawHandler = null
  let rangeSubscribedApi = null
  let currentOutput = null
  let currentProtoUpdatePosition = null

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
    _bufferMB = (chL.buffer.byteLength + chR.buffer.byteLength) / (1024 * 1024)
    _decodeMs = performance.now() - startedAt
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
        engineActive = false
      },
    }
  }

  function interceptOutput(output) {
    const proto = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(output),
      "handler",
    )
    let raw = null
    Object.defineProperty(output, "handler", {
      configurable: true,
      get() {
        return raw
      },
      set(value) {
        raw = value
        lastRawHandler = value
        proto.set.call(output, makeProxyHandler(raw))
      },
    })

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
      if (lastFrame !== null && data.frame < lastFrame && el)
        el.dispatchEvent(new Event("playing"))
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
    if (!api) return
    const mode =
      api.actualPlayerMode !== undefined
        ? api.actualPlayerMode
        : api.settings.player.playerMode
    if (mode !== EXTERNAL_MEDIA) return

    const output = api.player && api.player.output
    if (!output) return

    if (
      api !== lastSeenApi ||
      output !== lastSeenOutput ||
      output.handler !== lastRawHandler
    ) {
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
})()
