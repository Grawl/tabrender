"use strict"

// Phone layout for the bottom toolbar (`div.toolbar > div.scroll`, upstream flex row with
// horizontal scroll). Below 640px width the row wraps, via flexbox `order` rather than DOM
// reordering: Play and the three switch buttons (Loop, Count in, Metronome) first, then the
// track/audio selectors, then the speed menu button, then Edit (only present when logged in),
// each group dropping to its own line once it no longer fits — the toolbar's own height goes from
// a fixed 44px to auto so it can grow with the wrapped content. The switch buttons additionally get
// an iOS-style toggle knob drawn with a single `::before` pseudo-element instead of upstream's
// plain `.active` background, since the compact wrapped row leaves little room for a text-only
// active state; their padding/gap/font-size are shrunk from desktop so Play plus all three switches
// fit on one line at a 390px viewport. The knob uses a `>` (direct-child) selector so it only
// targets the switch buttons that are immediate children of `.scroll`, not the Edit button (which
// upstream nests inside `div.btn-edit`). The toolbar is `position: fixed` at the viewport bottom
// (upstream, unchanged here) and now taller than the desktop 44px, so `.main` (the score's
// containing block) gets bottom padding to match, or the fixed toolbar would permanently cover the
// tail of a scrolled-to-the-end score. The navbar's own right padding is shrunk to match on phones
// (`.mobile .my-navbar .toolbar[data-v-8f474ce9]{padding:0 0 0 10px}` upstream drops it entirely).
//
// Upstream's speed control (`div.select-percentage`, a plain number input in the toolbar) is
// hidden at every width and replaced with a "Speed N%" button that opens a menu with a slider and
// a number field, since a fixed set of presets does not cover the full 20-200% range usefully. The
// button and menu are DOM elements this script creates and maintains itself, since the toolbar is
// re-rendered by Vue on every tab navigation: a poll every 500ms re-creates them if missing and
// re-binds them to the (possibly new) upstream input, and removes them again only once the toolbar
// itself disappears. Applying a speed writes to the upstream input and dispatches native
// `input`/`change` events on it, which is what the Vue binding listens for; the upstream watcher
// clamps values below 20 to 20, so this addon clamps to the same [20, 200] range. The hide rule for
// the upstream input is scoped to `.toolbar .scroll .select-percentage` because the same
// `select-percentage` class is reused by the per-track volume input elsewhere in the UI, which must
// stay visible. The menu opens above the Speed button and stays inside the viewport: full width on
// phones, anchored to the button's left edge (clamped to the viewport) on desktop.
//
// At every width, the track-selector button also gets a `data-instrument` attribute set to an
// emoji picked from the current track's MIDI program (percussion checked first, since drum tracks
// report program 0 like a piano); on phones this replaces the button's text label with the emoji to
// save space, via CSS `content: attr(data-instrument)`. The dropdown list itself keeps the full
// track names.
//
// oxfmt (0.2.0) hoists any comment placed directly before a declaration out of its enclosing
// function, so this file keeps explanatory comments here in the header instead of inline.
;(function () {
  const style = document.createElement("style")
  style.textContent = `
.toolbar .scroll .select-percentage {
	display: none;
}
.mobile .my-navbar .toolbar > div.right {
	padding-right: 10px;
}
.speed-menu {
	position: fixed;
	z-index: 1000;
	width: 260px;
	background: #212529;
	border-radius: 8px;
	box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
	padding: 10px;
}
.speed-menu[hidden] {
	display: none;
}
.speed-menu-row {
	display: flex;
	align-items: center;
	gap: 10px;
}
.speed-menu-slider {
	flex: 1 1 auto;
	-webkit-appearance: none;
	background: transparent;
}
.speed-menu-slider::-webkit-slider-runnable-track {
	height: 6px;
	border-radius: 3px;
	background: repeating-linear-gradient(to right, #6c757d 0 2px, transparent 2px 12.5%), #495057;
}
.speed-menu-slider::-webkit-slider-thumb {
	-webkit-appearance: none;
	width: 28px;
	height: 28px;
	margin-top: -11px;
	border-radius: 50%;
	background: #0d6efd;
	border: 2px solid #fff;
}
.speed-menu-slider::-moz-range-track {
	height: 6px;
	border-radius: 3px;
	background: repeating-linear-gradient(to right, #6c757d 0 2px, transparent 2px 12.5%), #495057;
}
.speed-menu-slider::-moz-range-thumb {
	width: 28px;
	height: 28px;
	border-radius: 50%;
	background: #0d6efd;
	border: 2px solid #fff;
}
.speed-menu-value {
	width: 64px;
	flex: 0 0 64px;
	padding: 6px 4px;
}
.speed-menu-unit {
	flex: 0 0 auto;
	color: #adb5bd;
}
@media (max-width: 640px) {
	.toolbar {
		height: auto;
		min-height: 44px;
	}
	.toolbar .scroll {
		flex-wrap: wrap;
		overflow-x: visible;
		height: auto;
		row-gap: 6px;
		column-gap: 6px;
		padding: 6px 8px 8px 0;
		align-items: center;
	}
	body:has(.toolbar .scroll) .main {
		padding-bottom: 170px;
	}
	.toolbar .scroll > * {
		flex-shrink: 1;
	}
	.toolbar .scroll button.btn-primary {
		order: 1;
		flex: 1 1 auto;
		min-width: 84px;
	}
	.toolbar .scroll > button.btn-secondary:not(.speed-menu-btn) {
		order: 2;
		padding: 3px 4px;
		font-size: 11px;
		position: static;
	}
	.toolbar .scroll .track-selector {
		order: 3;
	}
	.toolbar .scroll .audio-selector {
		order: 4;
	}
	.toolbar .scroll .speed-menu-btn {
		order: 6;
	}
	.toolbar .scroll .btn-edit {
		order: 7;
	}
	.toolbar .scroll > button.btn-secondary:not(.speed-menu-btn)::before {
		content: "";
		display: inline-block;
		vertical-align: middle;
		width: 26px;
		height: 14px;
		margin-right: 6px;
		border-radius: 7px;
		background: radial-gradient(circle at 7px 50%, #fff 4.5px, transparent 5.5px), #343a40;
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
		transition: background-color 150ms ease;
	}
	.toolbar .scroll > button.btn-secondary.active:not(.speed-menu-btn)::before {
		background: radial-gradient(circle at 19px 50%, #fff 4.5px, transparent 5.5px), #198754;
	}
	.toolbar .scroll > button.btn-secondary.active:not(.speed-menu-btn) > svg {
		display: none;
	}
	.toolbar .scroll button.btn-secondary.disabled {
		opacity: 0.5;
	}
	.toolbar .scroll .btn-edit button,
	.toolbar .scroll .speed-menu-btn {
		padding: 6px 15px;
	}
	.toolbar .scroll .track-selector .button {
		min-width: 44px;
		padding: 10px 8px;
		text-align: center;
		font-size: 20px;
		line-height: 24px;
	}
	.toolbar .scroll .track-selector .button[data-instrument] span {
		display: none;
	}
	.toolbar .scroll .track-selector .button[data-instrument]::after {
		content: attr(data-instrument);
	}
	.speed-menu {
		width: auto;
		left: 8px;
		right: 8px;
	}
}
`
  document.head.appendChild(style)

  const MOBILE_QUERY = window.matchMedia("(max-width: 640px)")
  const MIN_SPEED = 20
  const MAX_SLIDER = 100
  const MAX_INPUT = 200
  const MENU_WIDTH = 260
  const POLL_MS = 500

  const nativeValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set

  let menuButton = null
  let menuElement = null
  let sliderInput = null
  let valueInput = null
  let boundInput = null

  function findScroll() {
    return document.querySelector(".toolbar .scroll")
  }

  function findUpstreamInput(scroll) {
    return scroll.querySelector(".select-percentage input.form-control")
  }

  function currentSpeed() {
    return boundInput ? Number(boundInput.value) || 100 : 100
  }

  function syncLabel() {
    if (menuButton) menuButton.textContent = `Speed ${currentSpeed()}%`
  }

  function syncMenuInputs(speed) {
    if (sliderInput)
      sliderInput.value = String(
        Math.min(MAX_SLIDER, Math.max(MIN_SPEED, speed)),
      )
    if (valueInput) valueInput.value = String(speed)
  }

  function applySpeed(rawValue) {
    if (!boundInput) return
    const clamped = Math.min(
      MAX_INPUT,
      Math.max(MIN_SPEED, Math.round(rawValue)),
    )
    nativeValueSetter.call(boundInput, String(clamped))
    boundInput.dispatchEvent(new Event("input", { bubbles: true }))
    boundInput.dispatchEvent(new Event("change", { bubbles: true }))
    syncLabel()
    syncMenuInputs(clamped)
  }

  function positionMenu(buttonRect) {
    menuElement.style.bottom = `${window.innerHeight - buttonRect.top + 8}px`
    if (MOBILE_QUERY.matches) {
      menuElement.style.left = "8px"
      menuElement.style.right = "8px"
    } else {
      menuElement.style.right = "auto"
      menuElement.style.left = `${Math.max(8, Math.min(buttonRect.left, window.innerWidth - MENU_WIDTH - 8))}px`
    }
  }

  function openMenu() {
    positionMenu(menuButton.getBoundingClientRect())
    syncMenuInputs(currentSpeed())
    menuElement.hidden = false
  }

  function closeMenu() {
    if (menuElement) menuElement.hidden = true
  }

  function toggleMenu() {
    if (menuElement.hidden) openMenu()
    else closeMenu()
  }

  function createMenuButton(scroll) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "btn btn-secondary speed-menu-btn"
    const reference = scroll.querySelector("button.btn")
    if (reference) {
      for (const attribute of reference.attributes) {
        if (attribute.name.startsWith("data-v-"))
          button.setAttribute(attribute.name, attribute.value)
      }
    }
    button.addEventListener("click", (event) => {
      event.stopPropagation()
      toggleMenu()
    })
    const percentageInput = scroll.querySelector(".select-percentage")
    if (percentageInput) scroll.insertBefore(button, percentageInput)
    else scroll.appendChild(button)
    return button
  }

  function createMenu() {
    const menu = document.createElement("div")
    menu.className = "speed-menu"
    menu.hidden = true

    const row = document.createElement("div")
    row.className = "speed-menu-row"

    const slider = document.createElement("input")
    slider.type = "range"
    slider.className = "speed-menu-slider"
    slider.min = String(MIN_SPEED)
    slider.max = String(MAX_SLIDER)
    slider.step = "5"
    slider.setAttribute("aria-label", "Playback speed")
    slider.addEventListener("input", () => {
      valueInput.value = slider.value
    })
    slider.addEventListener("change", () => applySpeed(Number(slider.value)))
    row.appendChild(slider)

    const value = document.createElement("input")
    value.type = "number"
    value.className = "speed-menu-value"
    value.min = String(MIN_SPEED)
    value.max = String(MAX_INPUT)
    value.step = "5"
    const commitValue = () => applySpeed(Number(value.value))
    value.addEventListener("change", commitValue)
    value.addEventListener("blur", commitValue)
    value.addEventListener("keydown", (event) => {
      if (event.key === "Enter") commitValue()
    })
    row.appendChild(value)

    const unit = document.createElement("span")
    unit.className = "speed-menu-unit"
    unit.textContent = "%"
    row.appendChild(unit)

    menu.appendChild(row)
    document.body.appendChild(menu)
    sliderInput = slider
    valueInput = value
    return menu
  }

  function bindUpstreamInput(input) {
    boundInput = input
    input.addEventListener("input", syncLabel)
    input.addEventListener("change", syncLabel)
  }

  function removeSpeedUi() {
    if (menuButton) menuButton.remove()
    if (menuElement) menuElement.remove()
    menuButton = null
    menuElement = null
    sliderInput = null
    valueInput = null
    boundInput = null
  }

  function iconForTrack(track) {
    if (track.isPercussion) return "\u{1F941}"
    const program = track.playbackInfo.program
    if (program >= 24 && program <= 31) return "\u{1F3B8}"
    if (program >= 32 && program <= 39) return "\u{1F3B8}B"
    if (program >= 40 && program <= 55) return "\u{1F3BB}"
    if (program >= 56 && program <= 79) return "\u{1F3B7}"
    if (program >= 80 && program <= 103) return "\u{1F39B}\uFE0F"
    if (program <= 23) return "\u{1F3B9}"
    return "\u{1F3B5}"
  }

  function syncTrackIcon(scroll) {
    const track = window.api && window.api.tracks && window.api.tracks[0]
    if (!track) return
    const button = scroll.querySelector(".track-selector .button")
    if (!button) return
    const icon = iconForTrack(track)
    if (button.getAttribute("data-instrument") !== icon)
      button.setAttribute("data-instrument", icon)
  }

  function tick() {
    const scroll = findScroll()
    const toolbar = scroll && scroll.closest(".toolbar")
    if (!scroll || !toolbar) {
      removeSpeedUi()
      return
    }

    if (!menuElement || !document.body.contains(menuElement))
      menuElement = createMenu()
    if (!menuButton || !scroll.contains(menuButton))
      menuButton = createMenuButton(scroll)

    const input = findUpstreamInput(scroll)
    if (input && input !== boundInput) bindUpstreamInput(input)
    syncLabel()
    syncTrackIcon(scroll)
  }

  document.addEventListener("click", (event) => {
    if (!menuElement || menuElement.hidden) return
    if (menuElement.contains(event.target) || event.target === menuButton)
      return
    closeMenu()
  })
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu()
  })
  window.addEventListener("resize", closeMenu)
  MOBILE_QUERY.addEventListener("change", tick)

  tick()
  setInterval(tick, POLL_MS)
})()
