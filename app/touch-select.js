"use strict"

// Touch-screen playback-range selection.
//
// alphaTab's own selection-handle addon (`.at-selection-handles`, see the Tab-*.js patch note in
// Dockerfile) is built for mouse dragging: pointer-events + setPointerCapture on thin 5px handles.
// That is unusable with a finger. Instead of dragging handles, a two-finger long-press picks the
// range directly: hold two fingers on the tab for a second, and the range between whatever beats
// they land on becomes the playback range. This hooks the same alphaTab internals the desktop addon
// uses (`api._selectionStart/_selectionEnd`, `applyPlaybackRangeFromHighlight`,
// `highlightPlaybackRange`, `boundsLookup`) because there is no public API for "set the range to
// these two beats". The CSS additions only enlarge touch targets on coarse pointers; desktop mouse
// behaviour is untouched.
// A finger is coarse: anywhere inside the beat's real bounds counts (the desktop handle drag
// additionally rejects the gap after the notes, which would reject most finger positions).
;(function () {
  const style = document.createElement("style")
  style.textContent = `
@media (pointer: coarse) {
	.at-selection-handle {
		touch-action: none;
		-webkit-user-select: none;
		user-select: none;
		-webkit-touch-callout: none;
	}
	.at-selection-handle::before {
		content: '';
		position: absolute;
		inset: -10px -16px;
	}
	.at-selection-close {
		touch-action: manipulation;
	}
	.at-selection-close::before {
		content: '';
		position: absolute;
		inset: -9px;
	}
	.at-touch-select-pending {
		-webkit-user-select: none;
		user-select: none;
		-webkit-touch-callout: none;
	}
}
`
  document.head.appendChild(style)

  const HOLD_MS = 1000
  const MOVE_TOLERANCE = 16
  let gesture = null

  function getContext() {
    const handles = document.querySelector(".at-selection-handles")
    const container = handles && handles.parentElement
    const api = window.api
    if (
      !container ||
      !api ||
      !api.boundsLookup ||
      !api.container ||
      api.container.element !== container
    ) {
      return null
    }
    return { container, api }
  }

  function touchToBeat(context, touch) {
    const rect = context.container.getBoundingClientRect()
    const x = touch.pageX - (rect.left + window.scrollX)
    const y = touch.pageY - (rect.top + window.scrollY)
    return context.api.boundsLookup.getBeatAtPos(x, y)
  }

  function applyRange(context, startBeat, endBeat) {
    try {
      const close = context.container.querySelector(
        ".at-selection-close.active",
      )
      if (close) close.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      context.api._selectionStart = { beat: startBeat }
      context.api._selectionEnd = { beat: endBeat }
      context.api.applyPlaybackRangeFromHighlight()
      context.api.highlightPlaybackRange(
        context.api._selectionStart.beat,
        context.api._selectionEnd.beat,
      )
    } catch (error) {
      console.warn("touch-select: failed to apply playback range", error)
    }
  }

  function clearPending() {
    if (gesture && gesture.container) {
      gesture.container.classList.remove("at-touch-select-pending")
      clearTimeout(gesture.timer)
    }
    gesture = null
  }

  function trackedTouches(touchList) {
    return [touchList[0], touchList[1]].map((touch) => ({
      identifier: touch.identifier,
      originX: touch.pageX,
      originY: touch.pageY,
      lastX: touch.pageX,
      lastY: touch.pageY,
    }))
  }

  function findTracked(identifier) {
    return gesture.touches.find((touch) => touch.identifier === identifier)
  }

  function resolveGesture() {
    if (!gesture) return
    const context = getContext()
    if (!context) {
      clearPending()
      return
    }
    const beats = gesture.touches.map((touch) =>
      touchToBeat(context, { pageX: touch.lastX, pageY: touch.lastY }),
    )
    if (!beats[0] || !beats[1] || beats[0] === beats[1]) {
      clearPending()
      return
    }
    applyRange(context, beats[0], beats[1])
    gesture.armed = true
    if (navigator.vibrate) navigator.vibrate(30)
  }

  document.addEventListener(
    "touchstart",
    (event) => {
      if (
        event.touches.length !== 2 ||
        document.body.classList.contains("at-selection-handle-drag")
      ) {
        clearPending()
        return
      }
      const context = getContext()
      if (!context) {
        clearPending()
        return
      }
      clearPending()
      context.container.classList.add("at-touch-select-pending")
      gesture = {
        container: context.container,
        touches: trackedTouches(event.touches),
        armed: false,
        timer: setTimeout(resolveGesture, HOLD_MS),
      }
    },
    { passive: false, capture: true },
  )

  document.addEventListener(
    "touchmove",
    (event) => {
      if (!gesture) return
      if (gesture.armed) {
        event.preventDefault()
        return
      }
      for (let index = 0; index < event.changedTouches.length; index++) {
        const touch = event.changedTouches[index]
        const tracked = findTracked(touch.identifier)
        if (!tracked) continue
        const movedX = Math.abs(touch.pageX - tracked.originX)
        const movedY = Math.abs(touch.pageY - tracked.originY)
        if (movedX > MOVE_TOLERANCE || movedY > MOVE_TOLERANCE) {
          clearPending()
          return
        }
        tracked.lastX = touch.pageX
        tracked.lastY = touch.pageY
      }
    },
    { passive: false, capture: true },
  )

  document.addEventListener(
    "touchend",
    (event) => {
      const closeButton =
        event.target &&
        event.target.closest &&
        event.target.closest(".at-selection-close")
      if (closeButton) {
        event.preventDefault()
        closeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        return
      }
      if (!gesture) return
      if (gesture.armed) event.preventDefault()
      if (event.touches.length === 0) clearPending()
    },
    { passive: false, capture: true },
  )

  document.addEventListener(
    "touchcancel",
    (event) => {
      if (!gesture) return
      if (gesture.armed) event.preventDefault()
      clearPending()
    },
    { passive: false, capture: true },
  )
})()
