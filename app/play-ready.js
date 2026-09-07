"use strict"

// Retry a synth Play press that landed during the soundfont fetch.
//
// Switching the audio source to Synth recreates alphaTab's synthesizer and refetches `/soundfont/sonivox.sf2` (about 1.3 MB). Pressing Play while that fetch is in flight calls `api.play()`, which is a silent no-op because the player is not ready yet — but the Vue component's own `playing` flag has already flipped to true (the button shows Pause), and it never recovers: playback never actually starts and the button never reflects the true state again. This addon watches for exactly that situation — the toolbar's Play button showing active while `api.playerState` is still 0 (not playing) — and re-issues `api.play()` once the synth reports `isReadyForPlayback`, so the tap the user already made takes effect instead of requiring a second one. The 400ms grace period after entering the pending state avoids firing on the brief moment `isReadyForPlayback` can be true just before playback state settles.
;(function () {
  const style = document.createElement("style")
  style.textContent = `body.at-play-pending .toolbar .scroll button.btn-primary{opacity:.6;cursor:progress}`
  document.head.appendChild(style)

  const POLL_MS = 250
  const READY_DELAY_MS = 400
  const SYNTH_MODE = 2

  let pendingApi = null
  let pendingSince = null
  let retried = false

  function reset() {
    pendingApi = null
    pendingSince = null
    retried = false
    document.body.classList.remove("at-play-pending")
  }

  function tick() {
    const api = window.api
    const mode = api && (api.actualPlayerMode ?? api.settings.player.playerMode)
    const wantsPlay = !!document.querySelector(
      ".toolbar .scroll button.btn-primary.active",
    )
    if (!api || mode !== SYNTH_MODE || !wantsPlay || api.playerState !== 0) {
      if (pendingApi) reset()
      return
    }

    if (pendingApi !== api) {
      pendingApi = api
      pendingSince = Date.now()
      retried = false
      document.body.classList.add("at-play-pending")
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
