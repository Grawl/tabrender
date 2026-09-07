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
// tail of a scrolled-to-the-end score.
//
// Upstream's speed control (`div.select-percentage`, a plain number input) is hidden on phones and
// replaced with a "Speed N%" button that opens a preset menu (50/60/.../100 plus a custom number
// field). The button and menu are DOM elements this script creates and maintains itself, since the
// toolbar is re-rendered by Vue on every tab navigation: a poll every 500ms re-creates them if
// missing and re-binds them to the (possibly new) upstream input, and removes them again once the
// viewport grows past the phone breakpoint. Applying a speed writes to the upstream input and
// dispatches native `input`/`change` events on it, which is what the Vue binding listens for.
//
// oxfmt (0.2.0) hoists any comment placed directly before a declaration out of its enclosing
// function, so this file keeps explanatory comments here in the header instead of inline.
;(function () {
  const style = document.createElement("style")
  style.textContent = `
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
	.toolbar .scroll button.btn-secondary {
		order: 2;
		padding: 3px 4px;
		font-size: 11px;
	}
	.toolbar .scroll .track-selector {
		order: 3;
	}
	.toolbar .scroll .audio-selector {
		order: 4;
	}
	.toolbar .scroll .select-percentage {
		display: none;
	}
	.toolbar .scroll .speed-menu-btn {
		order: 6;
	}
	.toolbar .scroll .btn-edit {
		order: 7;
	}
	.toolbar .scroll > button.btn-secondary:not(.speed-menu-btn) {
		position: static;
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
	.toolbar .scroll .select-percentage input.form-control {
		width: 64px;
		flex: 0 0 64px;
		padding-left: 4px;
		padding-right: 4px;
	}
	.speed-menu {
		position: fixed;
		left: 8px;
		right: 8px;
		z-index: 1000;
		background: #212529;
		border-radius: 8px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
		padding: 10px;
	}
	.speed-menu[hidden] {
		display: none;
	}
	.speed-menu-presets {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 8px;
	}
	.speed-menu-presets button {
		flex: 1 1 auto;
		min-width: 40px;
		min-height: 40px;
		padding: 8px 4px;
		font-size: 13px;
	}
	.speed-menu-presets button.active {
		background-color: #0d6efd;
		border-color: #0d6efd;
	}
	.speed-menu-custom {
		display: flex;
		gap: 6px;
	}
	.speed-menu-custom input {
		flex: 1 1 auto;
		min-height: 40px;
		min-width: 0;
	}
	.speed-menu-custom button {
		min-height: 40px;
		min-width: 56px;
	}
}
`
  document.head.appendChild(style)

  const MOBILE_QUERY = window.matchMedia("(max-width: 640px)")
  const PRESET_SPEEDS = [50, 60, 70, 75, 80, 90, 100]
  const POLL_MS = 500

  const nativeValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set

  let menuButton = null
  let menuElement = null
  let presetButtons = []
  let customInput = null
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

  function applySpeed(rawValue) {
    if (!boundInput) return
    const clamped = Math.min(200, Math.max(10, Math.round(rawValue)))
    nativeValueSetter.call(boundInput, String(clamped))
    boundInput.dispatchEvent(new Event("input", { bubbles: true }))
    boundInput.dispatchEvent(new Event("change", { bubbles: true }))
    syncLabel()
    closeMenu()
  }

  function openMenu(toolbar) {
    const toolbarRect = toolbar.getBoundingClientRect()
    menuElement.style.bottom = `${toolbarRect.height + 8}px`
    const speed = currentSpeed()
    customInput.value = String(speed)
    for (const presetButton of presetButtons) {
      presetButton.classList.toggle(
        "active",
        Number(presetButton.dataset.speed) === speed,
      )
    }
    menuElement.hidden = false
  }

  function closeMenu() {
    if (menuElement) menuElement.hidden = true
  }

  function toggleMenu(toolbar) {
    if (menuElement.hidden) openMenu(toolbar)
    else closeMenu()
  }

  function createMenuButton(scroll, toolbar) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "btn btn-secondary speed-menu-btn"
    button.addEventListener("click", (event) => {
      event.stopPropagation()
      toggleMenu(toolbar)
    })
    scroll.appendChild(button)
    return button
  }

  function createMenu() {
    const menu = document.createElement("div")
    menu.className = "speed-menu"
    menu.hidden = true

    const presets = document.createElement("div")
    presets.className = "speed-menu-presets"
    const buttons = PRESET_SPEEDS.map((speed) => {
      const presetButton = document.createElement("button")
      presetButton.type = "button"
      presetButton.className = "btn btn-secondary"
      presetButton.dataset.speed = String(speed)
      presetButton.textContent = String(speed)
      presetButton.addEventListener("click", () => applySpeed(speed))
      presets.appendChild(presetButton)
      return presetButton
    })
    menu.appendChild(presets)

    const custom = document.createElement("div")
    custom.className = "speed-menu-custom"
    const input = document.createElement("input")
    input.type = "number"
    input.min = "10"
    input.max = "200"
    input.step = "5"
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") applySpeed(Number(input.value))
    })
    const okButton = document.createElement("button")
    okButton.type = "button"
    okButton.className = "btn btn-primary"
    okButton.textContent = "OK"
    okButton.addEventListener("click", () => applySpeed(Number(input.value)))
    custom.appendChild(input)
    custom.appendChild(okButton)
    menu.appendChild(custom)

    document.body.appendChild(menu)
    presetButtons = buttons
    customInput = input
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
    presetButtons = []
    customInput = null
    boundInput = null
  }

  function tick() {
    if (!MOBILE_QUERY.matches) {
      removeSpeedUi()
      return
    }
    const scroll = findScroll()
    const toolbar = scroll && scroll.closest(".toolbar")
    if (!scroll || !toolbar) return

    if (!menuElement || !document.body.contains(menuElement))
      menuElement = createMenu()
    if (!menuButton || !scroll.contains(menuButton))
      menuButton = createMenuButton(scroll, toolbar)

    const input = findUpstreamInput(scroll)
    if (input && input !== boundInput) bindUpstreamInput(input)
    syncLabel()
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
  MOBILE_QUERY.addEventListener("change", tick)

  tick()
  setInterval(tick, POLL_MS)
})()
