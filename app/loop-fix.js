"use strict"

// Looping a playback range with an external audio file (render.mp3 as backing track).
//
// alphaTab 1.8 restarts a loop correctly with its own synthesizer, but in external-media mode it
// seeks the audio one bar past the range start and leaves the player paused. This addon restarts
// the loop itself: after alphaTab's own (broken) restart it seeks to the range start through the
// public api and resumes playback. The synthesizer mode is left alone.
// alphaTab.PlayerMode.EnabledExternalMedia

// The player creates (and re-creates) the alphaTab api while navigating between tabs.
;(function () {
  const EXTERNAL_MEDIA = 4
  let attached = null

  function attach(api) {
    attached = api
    api.playerFinished.on(() => {
      const range = api.playbackRange
      if (
        !api.isLooping ||
        !range ||
        api.settings.player.playerMode !==
          EXTERNAL_MEDIA
      )
        return
      setTimeout(() => {
        if (
          window.api !==
          api
        )
          return
        api.tickPosition = range.startTick
        api.play()
      }, 0)
    })
  }
  setInterval(() => {
    const api = window.api
    if (api && api !== attached && api.playerFinished) attach(api)
  }, 1000)
})()
