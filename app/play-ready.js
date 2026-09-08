"use strict"

// Retry a synth Play press that landed during the soundfont fetch, and surface a loading indicator for every reason Play can go silent on a phone: the synth's soundfont fetch, the loop engine's render.mp3 fetch/decode, and native <audio> buffering.
//
// Switching the audio source to Synth recreates alphaTab's synthesizer and refetches `/soundfont/sonivox.sf2` (about 1.3 MB). Pressing Play while that fetch is in flight calls `api.play()`, which is a silent no-op because the player is not ready yet — but the Vue component's own `playing` flag has already flipped to true (the button shows Pause), and it never recovers: playback never actually starts and the button never reflects the true state again. This addon watches for exactly that situation — the toolbar's Play button showing active while `api.playerState` is still 0 (not playing) — and re-issues `api.play()` once the synth reports `isReadyForPlayback`, so the tap the user already made takes effect instead of requiring a second one. The 400ms grace period after entering the pending state avoids firing on the brief moment `isReadyForPlayback` can be true just before playback state settles.
//
// The same silent gap also happens without ever needing a retry: on a slow connection the soundfont fetch, `loop-audio.js`'s render.mp3 fetch/decode, or the `<audio>` element's own buffering can all keep Play pressed with nothing audible for several seconds, and nothing in the UI said so. This addon now polls all three sources every 250ms and renders a `div.playback-status` pill above the toolbar with a human label ("Loading sound font… 45 %", "Loading render… 45 %", "Preparing audio…", "Buffering…"), plus a spinner inside the Play button itself. The soundfont label reads `api.isReadyForPlayback` and `api.soundFontLoad`'s progress events directly; the render label reads `window.__loopAudio.state`/`progress`/`fetchStartedAt` (see `loop-audio.js`), shown only while Play is pressed or the fetch started less than 10s ago so an idle background fetch never surfaces a label; the buffering label watches the `<audio class="player">` element's own `waiting`/`stalled`/`playing`/`canplay` events.
//
// The Play button's spinner rides the existing `body.at-play-pending` class, now driven by a single general rule instead of the synth-only retry state: pending is true whenever Play is pressed and playback has not actually started (`api.playerState === 0`, or the `<audio>` element is unpaused but not buffered enough to play, `readyState < 3`). That condition already covers all three loading sources, since none of them lets `playerState` reach "playing" while they are in flight. The pending style hides the button's clip-path play/pause glyph (`::before`) and its pause bar (`::after`) and replaces `::before` with a rotating ring, at higher selector specificity than `mobile-ui.js`'s own Play button rules so it wins regardless of which `<style>` element `<head>` puts last.
;(function () {
  const style = document.createElement("style")
  style.textContent = `
body.at-play-pending .toolbar .scroll button.btn-primary {
	opacity: 1;
	cursor: progress;
}
body.at-play-pending .toolbar .scroll button.btn-primary::before {
	content: "";
	top: 50%;
	left: 50%;
	margin: -10px 0 0 -10px;
	width: 20px;
	height: 20px;
	background: none;
	clip-path: none;
	border: 3px solid rgba(255, 255, 255, 0.3);
	border-top-color: currentColor;
	border-radius: 50%;
	animation: play-ready-spin 0.8s linear infinite;
}
body.at-play-pending .toolbar .scroll button.btn-primary::after {
	content: none;
}
@keyframes play-ready-spin {
	to {
		transform: rotate(360deg);
	}
}
.playback-status {
	position: fixed;
	left: 50%;
	transform: translate(-50%, -100%);
	background: rgba(0, 0, 0, 0.8);
	color: #fff;
	font-size: 13px;
	line-height: 1.4;
	padding: 4px 10px;
	border-radius: 999px;
	pointer-events: none;
	white-space: nowrap;
	z-index: 1000;
	display: none;
}
.playback-status.visible {
	display: block;
}
`
  document.head.appendChild(style)

  const POLL_MS = 250
  const READY_DELAY_MS = 400
  const SYNTH_MODE = 2
  const RENDER_LABEL_WINDOW_MS = 10000

  let pendingApi = null
  let pendingSince = null
  let retried = false

  let soundFontApi = null
  let soundFontProgress = null

  let attachedAudioEl = null
  let audioBuffering = false

  let statusEl = null

  function resetRetry() {
    pendingApi = null
    pendingSince = null
    retried = false
  }

  function handleSoundFontProgress(progress) {
    soundFontProgress =
      progress && progress.total > 0
        ? { loaded: progress.loaded, total: progress.total }
        : null
  }

  function handleSoundFontLoaded() {
    soundFontProgress = null
  }

  function attachSoundFontEvents(api) {
    if (soundFontApi === api) return
    soundFontApi = api
    soundFontProgress = null
    if (api.soundFontLoad && typeof api.soundFontLoad.on === "function") {
      api.soundFontLoad.on(handleSoundFontProgress)
    }
    if (api.soundFontLoaded && typeof api.soundFontLoaded.on === "function") {
      api.soundFontLoaded.on(handleSoundFontLoaded)
    }
  }

  function handleAudioWaiting(event) {
    if (!event.target.paused) audioBuffering = true
  }

  function handleAudioReady() {
    audioBuffering = false
  }

  function attachAudioListeners(audioEl) {
    if (attachedAudioEl === audioEl) return
    attachedAudioEl = audioEl
    audioBuffering = false
    audioEl.addEventListener("waiting", handleAudioWaiting)
    audioEl.addEventListener("stalled", handleAudioWaiting)
    audioEl.addEventListener("playing", handleAudioReady)
    audioEl.addEventListener("canplay", handleAudioReady)
  }

  function isPendingStart(api, wantsPlay, audioEl) {
    if (!wantsPlay) return false
    if (api && api.playerState === 0) return true
    return !!(audioEl && !audioEl.paused && audioEl.readyState < 3)
  }

  function computeSynthLabel(api, mode) {
    if (!api || mode !== SYNTH_MODE || api.isReadyForPlayback !== false)
      return null
    if (soundFontProgress) {
      const percent = Math.round(
        (soundFontProgress.loaded / soundFontProgress.total) * 100,
      )
      return `Loading sound font… ${percent} %`
    }
    return "Loading sound font…"
  }

  function computeRenderLabel(wantsPlay) {
    const loopAudio = window.__loopAudio
    if (!loopAudio) return null
    const state = loopAudio.state
    if (state !== "fetching" && state !== "decoding") return null
    const startedAt = loopAudio.fetchStartedAt
    const isRecent =
      typeof startedAt === "number" &&
      Date.now() - startedAt < RENDER_LABEL_WINDOW_MS
    if (!wantsPlay && !isRecent) return null
    if (state === "decoding") return "Preparing audio…"
    const progress = loopAudio.progress
    return progress === null
      ? "Loading render…"
      : `Loading render… ${Math.round(progress * 100)} %`
  }

  function computeBufferingLabel(audioEl) {
    if (!audioBuffering || !audioEl || audioEl.paused) return null
    return "Buffering…"
  }

  function computeLabel(api, mode, wantsPlay, audioEl) {
    return (
      computeSynthLabel(api, mode) ||
      computeRenderLabel(wantsPlay) ||
      computeBufferingLabel(audioEl)
    )
  }

  function ensureStatusEl() {
    if (statusEl) return statusEl
    statusEl = document.createElement("div")
    statusEl.className = "playback-status"
    document.body.appendChild(statusEl)
    return statusEl
  }

  function updateStatus(label, toolbar) {
    const element = ensureStatusEl()
    if (!label) {
      element.classList.remove("visible")
      return
    }
    element.textContent = label
    if (toolbar) {
      const rect = toolbar.getBoundingClientRect()
      element.style.top = `${rect.top - 8}px`
    }
    element.classList.add("visible")
  }

  function tick() {
    const api = window.api
    const mode = api && (api.actualPlayerMode ?? api.settings.player.playerMode)
    const playButton = document.querySelector(
      ".toolbar .scroll button.btn-primary",
    )
    const wantsPlay = !!(playButton && playButton.classList.contains("active"))
    const toolbar = playButton && playButton.closest(".toolbar")
    const audioEl = document.querySelector("audio.player")

    if (audioEl) attachAudioListeners(audioEl)
    if (api) attachSoundFontEvents(api)

    document.body.classList.toggle(
      "at-play-pending",
      isPendingStart(api, wantsPlay, audioEl),
    )
    updateStatus(computeLabel(api, mode, wantsPlay, audioEl), toolbar)

    if (!api || mode !== SYNTH_MODE || !wantsPlay || api.playerState !== 0) {
      if (pendingApi) resetRetry()
      return
    }

    if (pendingApi !== api) {
      pendingApi = api
      pendingSince = Date.now()
      retried = false
      return
    }

    if (
      !retried &&
      api.isReadyForPlayback &&
      Date.now() - pendingSince >= READY_DELAY_MS
    ) {
      retried = true
      api.play()
    }
  }

  setInterval(tick, POLL_MS)
})()
