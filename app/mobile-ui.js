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
// At every width, the track-selector button also gets a small inline SVG icon inserted before the
// (phone-hidden) name span, picked from the current track's MIDI program via a fixed category map
// (percussion checked first, since drum tracks report program 0 like a piano; see `categoryForTrack`).
// On phones this is the only visible content, since the name text is hidden via CSS; on desktop the
// icon sits to the left of the visible name for consistency with the rest of the toolbar. The
// dropdown list itself keeps the full track names. The button may be re-created by Vue, so the icon
// is re-inserted whenever it is missing, the same way the speed button handles re-creation.
//
// Icon path data (`INSTRUMENT_ICONS`) is taken from the game-icons.net set by Delapouite, Caro
// Asercion, Zajkonur and Skoll, licensed CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/).
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
.toolbar .scroll .track-selector .button .track-icon {
	width: 18px;
	height: 18px;
	vertical-align: middle;
	margin-right: 6px;
	flex-shrink: 0;
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
	.toolbar .scroll .track-selector .button span {
		display: none;
	}
	.toolbar .scroll .track-selector .button .track-icon {
		width: 24px;
		height: 24px;
		margin-right: 0;
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
  const SVG_NS = "http://www.w3.org/2000/svg"

  const INSTRUMENT_ICONS = {
    guitar:
      "M152.6 26.32L137.2 441.9 256 486.4l118.8-44.5-15.4-415.58L256 41.09 152.6 26.32zM64 89c-36 0-36 78 0 78h9.51l13-39-13-39H64zm374.5 0l-13 39 13 39h9.5c36 0 36-78 0-78h-9.5zM192 112a16 16 0 0 1 16 16 16 16 0 0 1-16 16 16 16 0 0 1-16-16 16 16 0 0 1 16-16zm128 0a16 16 0 0 1 16 16 16 16 0 0 1-16 16 16 16 0 0 1-16-16 16 16 0 0 1 16-16zm-217.6 7l2.1 6.2 1 2.8-3 9h28l.7-18h-28.8zm278.4 0l.7 18h28.1l-2.1-6.2-1-2.8 3-9h-28.7zM60 217c-36 0-36 78 0 78h9.51l13-39-13-39H60zm382.5 0l-13 39 13 39h9.5c36 0 36-78 0-78h-9.5zM192 240a16 16 0 0 1 16 16 16 16 0 0 1-16 16 16 16 0 0 1-16-16 16 16 0 0 1 16-16zm128 0a16 16 0 0 1 16 16 16 16 0 0 1-16 16 16 16 0 0 1-16-16 16 16 0 0 1 16-16zm-221.56 7l2.06 6.2 1 2.8-3 9h27.3l.7-18H98.44zm287.06 0l.7 18h27.4l-2.1-6.2-1-2.8 3-9h-28zM56 345c-36 0-36 78 0 78h9.51l13-39-13-39H56zm390.5 0l-13 39 13 39h9.5c36 0 36-78 0-78h-9.5zM192 368a16 16 0 0 1 16 16 16 16 0 0 1-16 16 16 16 0 0 1-16-16 16 16 0 0 1 16-16zm128 0a16 16 0 0 1 16 16 16 16 0 0 1-16 16 16 16 0 0 1-16-16 16 16 0 0 1 16-16zm-225.53 7l2.07 6.2.95 2.8-3 9h26.61l.6-18H94.47zm295.83 0l.6 18h26.7l-2.1-6.2-1-2.8 3-9h-27.2z",
    bass: "M228.2 26.89c-15.2-.25-27.7 33.46-12.3 39.8l8.9 3.61 17.8-15.5-1.8-23.5-8.7-3.6c-1.1-.43-2.1-.68-3.2-.78h-.7zm134.4 7.92h-2.3c-7.4.3-15.3 2.12-23.3 5.75-21.2 9.67-43.6 32.67-59.7 75.74L174.4 394.7l-.1.2v.2c.9.5 3.6 1.9 8 4 9.8 4.8 24 15.7 26.1 38.8v.5l-1 55.6H304c-.1-17.6 1.4-34.5 8.1-51.5 11.7-29.4 39.3-54.9 97-77 0-.2 0 0 .1-.4.3-2 .4-6 0-11-1-10.1-4-24.9-8.6-42.2-9.2-34.7-24.8-80.2-42.4-124.9l-2.4-6.2 5.2-4.2c36.1-28.2 51.1-56.4 53.8-79.56 2.7-23.06-6.5-41.48-21.3-52.25-8.7-6.31-19.3-9.99-30.9-10.02zM260.5 52.44l.7 10.01-7.6 6.6 21.7 8.93c1.2-2.17 2.5-4.28 3.8-6.33l4-9.89zm69 18.56c8.8 0 16 7.16 16 16s-7.2 16-16 16-16-7.16-16-16 7.2-16 16-16zm-136.7 49.7c-15.2-.3-27.9 33.4-12.3 39.8l8.8 3.6 17.8-15.5-1.7-23.6-8.8-3.6c-1.1-.4-2.1-.6-3.1-.7zm32.2 25.5l.7 10-7.6 6.6 19.9 8.1 6.2-16.8zm71.6 19.8c8.8 0 16 7.2 16 16s-7.2 16-16 16-16-7.2-16-16 7.2-16 16-16zm-139.8 50.6c-15.3-.3-27.8 33.4-12.4 39.8l8.9 3.6 17.8-15.5-1.8-23.6-8.7-3.6c-1.1-.4-2.1-.6-3.1-.7zm32.2 25.5l.7 10-7.6 6.6 20.4 8.3 6.2-16.8zm67.2 19.3c8.8 0 16 7.2 16 16s-7.2 16-16 16-16-7.2-16-16 7.2-16 16-16zm-140.1 54.4c-15.2-.3-27.78 33.4-12.3 39.8l8.8 3.6 17.8-15.5-1.8-23.6-8.7-3.6c-1.1-.4-2.1-.6-3.1-.7zm32.2 25.5l.7 10-7.6 6.6 22.8 9.3 6.8-16.6zm69.3 18.5c8.8 0 16 7.2 16 16s-7.2 16-16 16-16-7.2-16-16 7.2-16 16-16z",
    drums:
      "m111 58.3-87.37.4-.61 8.3L192.4 92.6l1.8-8.1zm310.8 18.8-.3 29.7 5-.8 4.9.8-.3-29.7zM96.33 92.8l-1.81 13-33.17 26.4 1.84 115.6 6.16-40.4 9.55-2.3h.28l-1.03-65 31.95-25.4 2.7-19.4zm330.17 25.9-66.6 10.4.6 8.3h132l.6-8.3zm-66 33.3-.6 8.3 66.6 10.4 66.6-10.4-.6-8.3zm60.3 30.5-.2 20.8c2.8.5 5.6 1.2 8.5 1.8l3.3.8-.2-23.4-5.7.9zm-287.4 30.7c-16.5-.2-33.5 1.9-51.1 6.1l-2.86 18.8c23.26-3.3 75.96-6.9 127.56 14.6 4-1.6 8.2-3.1 12.4-4.3l1.2-8c-26.6-18.2-55.8-26.8-87.2-27.2zm241.2 0c-31.4.4-60.6 9-87.2 27.2l1.2 8c4.2 1.2 8.4 2.7 12.4 4.3 51.6-21.5 104.3-17.9 127.6-14.6l-2.9-18.8c-17.6-4.2-34.6-6.3-51.1-6.1zm-258.1 39c-17.91 0-32.1 1.8-39.69 3.1l-7.05 46.3 72.94 11.1c10.1-20.3 25.5-37.5 44.5-49.6-25.4-8.5-50.4-10.9-70.7-10.9zm275 0c-20.3 0-45.3 2.4-70.7 10.9 19 12.1 34.4 29.3 44.5 49.6l72.9-11.1-7-46.3c-7.6-1.3-21.8-3.1-39.7-3.1zm-137.5 10c-49.9 0-90.4 40.5-90.4 90.4 0 49.9 40.5 90.4 90.4 90.4 49.9 0 90.4-40.5 90.4-90.4 0-49.9-40.5-90.4-90.4-90.4zM64.27 315.5l1.36 85.5-46.73 87h18.94l33.24-62 15.19 62h17.23l-21.19-86-1.33-84zM433.6 317l-14.2 2.2-.8 74.1-24.2 55.7 7.4 25 24.7-57 30.9 71h18.2l-41.2-94.7zm-279.7 11.6c-4.7 12.1-7.2 25.2-7.2 38.9C146.7 427 194.8 475 254 475c59.2 0 107.3-48 107.3-107.5 0-13.7-2.5-26.8-7.2-38.9 1.8 7.7 2.8 15.8 2.8 24C356.9 409 310.8 456 254 456c-56.8 0-102.9-47-102.9-103.4 0-8.2 1-16.3 2.8-24zm-18 77.4-20.2 82h25.7l11.8-48c-7.4-11-13.3-22-17.3-34zm236.2 0c-4 12-9.9 23-17.3 34l11.8 48h25.7z",
    keys: "M369.1 19.82L19.81 369.1 142.9 492.2l69.3-69.3-79.2-79.2L412.9 63.66zM374 57.3l12.8 12.72-56.5 56.58-12.8-12.8zm51.7 19.1L413 89.12l66.5 66.48 12.7-12.7zm-25.5 25.5l-12.6 12.7 66.5 66.5 12.6-12.7zm-25.4 25.5L362.1 140l66.5 66.5 12.6-12.7zm-25.5 25.4l-12.6 12.7 66.5 66.4 12.6-12.6zm-74.3 3.5l12.8 12.8-11.3 11.3-12.8-12.8zm48.9 22L311.2 191l66.5 66.4 12.6-12.6zm-74.3 3.4l12.8 12.8-11.3 11.3-12.8-12.8zm48.8 22.1l-12.6 12.6 66.4 66.4 12.7-12.6zm-82.8 11.9l12.8 12.8-33.9 33.9-12.8-12.8zm57.4 13.5l-12.7 12.7 66.5 66.4 12.6-12.6zm-25.6 25.5l-12.6 12.6 66.5 66.5 12.6-12.6zm-88.3 17.5l12.8 12.8-34 34-12.8-12.8zm62.9 7.9l-12.6 12.7 66.4 66.4 12.7-12.6zm-25.4 25.5l-12.7 12.6 66.5 66.5 12.7-12.6zM86.27 322.5l35.33 35.3-46.64 46.7-29-29-6.35-6.4zm84.83 8.5l-12.7 12.7 66.5 66.5 12.7-12.7zm-84.83 16.9l-21.22 21.2 9.91 10 21.21-21.3zm38.83 26.2l12.8 12.8-33.9 33.9L91.23 408zm22.7 22.6l12.8 12.8-34 33.9-12.8-12.8zm22.6 22.6l12.8 12.8-33.9 34-12.8-12.8z",
    strings:
      "M470.9 26l-23 7.69-.1 12.66 17.8 17.81 12.7-.1 7.7-23.04zm-32.5 37l-227 210.5 27.2 27L449 73.57zm-39.6-19.33L385.7 56.7l15.6 15.5 13.5-12.53zm53.5 53.59l-12.5 13.54 15.5 15.4 13.1-13zm-79.6-27.52l-13 13.02 14.6 14.61 13.5-12.58zm54.5 54.46l-12.5 13.6 14.5 14.5 13.1-13.1zm-124 39.2c-28.7-17.5-72-25.4-116.3 47.8l-7.2-1.4-7.3 13c3.8 1 13.5 8.2 12.4 12.1-3.5 11.3-48.2 64.3-70.6 44.5-2.9-2.6-5.8-5.7-8-9.6l-14.35 7.9c1.23 10-1.95 13.8-6.38 15.8-82.975 36.6-64.15 78.6-33.01 126.9l3.11-3c22.09-22.2 43.62-54.6 62.73-82.7l6.1-9.3 13 13 10.1-10.1-10.8-10.9 18.8-7.3 5.1 5.2 33.3-33.4c-2.9-3-5.9-6-8.9-8.9zm45.5 45.5L239 327l-8.9-8.9-33.3 33.3 5 5.1-7.1 18.9-10.9-11-10.1 10.2 12.8 12.9-9.2 6.3c-27.6 18.9-60.6 40.6-82.61 62.7l-3.14 3c48.45 31.2 90.45 50 127.05-33 2-4.4 5.7-7.6 15.8-6.4l7.8-14.3c-3.8-2.3-7-5-9.6-8-19.8-22.4 33.2-67.2 44.5-70.7 3.9-1.1 11 8.6 12.1 12.4l13-7.1-1.4-7.2c73.2-44.3 65.4-87.7 47.9-116.3zM206.9 295l-33.2 33.3 10.1 10.1 33.3-33.3zm-46.3 46.3l-10.2 10.1 10.2 10.1 10.1-10.1zm-33.4 13c-16.4 24.2-34.63 51-54.84 72l2.97 10.3 10.36 3c21.11-20.1 48.01-38.4 72.11-54.8z",
    winds:
      "M151.21 26.775c-18.385 2.518-37.75 18.106-48.784 28.028l15.607 18.527c17.103-12.17 32.453-18.857 36.975-5.98 43.955 125.186 102.805 440.16 214.205 416.636 90.158-25.674 42.966-127.593 56.11-188.435 2.508-10.346 8.965-23.229 21.237-22.842 11.477.362 6.472-5.97 2.8-7.682-35.743-19.406-80.315-25.59-117.909-38.12-11.833-3.945-8.18 4.162-5.371 10.28 4.217 9.188 2.88 41.07 5.293 54.526a32.625 32.625 0 0 1 15.105-3.707c18.12 0 33 14.881 33 33 0 6.41-1.87 12.412-5.08 17.496 10.623 5.506 17.947 16.611 17.947 29.318 0 18.12-14.88 33-33 33-1.186 0-2.358-.067-3.513-.191-.511 4.767-2.01 8.147-4.81 9.693-10.326 3.204-45.397-73.375-83.014-161.382-6.54 3.924-12.608 5.998-19.31 5.212 17.077 46.103 35.722 91.756 58.396 136.98l-16.09 8.067c-45.888-91.528-75.273-184.003-107.725-277.195l16.998-5.92c2.355 6.764 4.67 13.496 6.996 20.24a27.134 27.134 0 0 1 10.82-5.945c-14.584-34.816-28.005-66.631-38.576-90.332-5.286-7.657-17.624-13.574-28.306-13.272zM89.522 67.424C77.28 80.24 66.187 94.324 58.33 106.93l7.474 8.806c8.001-5.403 22.698-19.026 37.948-31.418zm135.737 79.97c-5.1 0-9.041 3.942-9.041 9.042s3.941 9.04 9.04 9.04c5.1 0 9.042-3.94 9.042-9.04s-3.942-9.041-9.041-9.041zm12.707 34.122c-5.1 0-9.041 3.941-9.041 9.04 0 5.1 3.941 9.042 9.04 9.042 5.1 0 9.04-3.942 9.04-9.041 0-5.1-3.94-9.041-9.04-9.041zm13.904 36.752c-5.1 0-9.041 3.94-9.041 9.039 0 5.1 3.941 9.04 9.04 9.04 5.1 0 9.042-3.94 9.042-9.04s-3.942-9.04-9.041-9.04zm94.61 87.738c-8.392 0-15 6.609-15 15 0 8.39 6.608 15 15 15 8.39 0 15-6.61 15-15 0-8.391-6.61-15-15-15zm12.866 46.814c-8.39 0-15 6.61-15 15 0 8.391 6.61 15 15 15 8.391 0 15-6.609 15-15 0-8.39-6.609-15-15-15z",
    synth:
      "M468.53 236.03H486v39.94h-17.47v-39.94zm-34.426 51.634h17.47v-63.328h-17.47v63.328zm-33.848 32.756h17.47V191.58h-17.47v128.84zm-32.177 25.276h17.47V167.483h-17.47v178.17zm-34.448-43.521h17.47v-92.35h-17.47v92.35zm-34.994 69.879h17.47v-236.06h-17.525v236.06zM264.2 405.9h17.47V106.1H264.2V405.9zm-33.848-46.284h17.47V152.383h-17.47v207.234zm-35.016-58.85h17.47v-87.35h-17.47v87.35zm-33.847-20.823h17.47V231.98h-17.47v48.042zm-33.848 25.66h17.47v-99.24h-17.47v99.272zm-33.302 48.04h17.47V152.678H94.34v201zm-33.847-30.702h17.47V187.333h-17.47v135.642zM26 287.664h17.47v-63.328H26v63.328z",
    vocals:
      "M388.938 29.47c-23.008 0-46.153 9.4-62.688 25.405 5.74 46.14 21.326 75.594 43.75 94.28 22.25 18.543 52.078 26.88 87.75 28.345 13.432-16.07 21.188-37.085 21.188-58 0-23.467-9.75-47.063-26.344-63.656C436 39.25 412.404 29.47 388.938 29.47zm-76.282 42.374c-8.808 14.244-13.75 30.986-13.75 47.656 0 23.467 9.782 47.063 26.375 63.656 16.595 16.594 40.19 26.375 63.658 26.375 18.678 0 37.44-6.196 52.687-17.093-31.55-3.2-59.626-12.46-81.875-31-23.277-19.397-39.553-48.64-47.094-89.593zm-27.78 67.72l-64.47 83.78c2.898 19.6 10.458 35.1 22.094 46.187 11.692 11.142 27.714 18.118 48.594 19.626l79.312-65.28c-21.2-3.826-41.14-14.11-56.437-29.407-14.927-14.927-25.057-34.286-29.095-54.907zM300 201.468a8 8 0 0 1 .03 0 8 8 0 0 1 .533 0 8 8 0 0 1 5.875 13.374l-34.313 38.78a8.004 8.004 0 1 1-12-10.593l34.313-38.78a8 8 0 0 1 5.562-2.78zM207.594 240L103 375.906c3.487 13.327 7.326 20.944 12.5 26.03 5.03 4.948 12.386 8.46 23.563 12.408l135.312-111.438c-17.067-3.61-31.595-11.003-42.906-21.78-11.346-10.81-19.323-24.827-23.876-41.126zM95.97 402.375c-9.12 5.382-17.37 14.08-23.126 24.406-9.656 17.317-11.52 37.236-2.25 50.47 6.665 4.337 10.566 4.81 13.844 4.344 1.794-.256 3.618-.954 5.624-1.875-3.18-9.575-6.3-20.93-2.5-33.314 3.03-9.87 10.323-19.044 23.47-27.5-2.406-1.65-4.644-3.49-6.75-5.562-3.217-3.163-5.94-6.78-8.313-10.97z",
    other:
      "M98.05 18.54c-11.46-.08-23.59 1.28-36.08 3.99L130.1 261.1c-14.2-5.1-31.18-6.2-48.09-3.2-39.17 6.9-67.15 33.8-62.52 59.8 4.64 26.1 40.14 41.7 79.33 34.7 39.08-6.9 67.08-33.7 62.38-59.8-22.1-80.8-44.4-163-66.39-244.21 50.69 3.59 72.59 31.58 90.59 60.31-.5-62.33-37.7-89.81-87.35-90.16zm310.65 30.7c-13.9.1-28.8 2.59-44.1 7.22l87.1 232.44c-14.6-3.9-31.6-3.7-48.3.7-38.4 10-64.2 39-57.5 64.6 6.7 25.7 43.4 38.3 81.8 28.2 38.5-10 64.2-39 57.5-64.6-28.6-78.8-57.3-158.9-85.8-238.2 50.8-.5 74.9 25.7 95.2 52.9-5.2-58.55-40.4-83.61-85.9-83.26zM258.4 163.5l1.8 248.1c-12.3-8.6-28.4-14.3-45.6-15.9-39.4-3.8-73.7 14.5-76.2 41-2.5 26.3 27.7 50.8 67.1 54.5 39.7 3.9 73.7-14.5 76.3-40.9.2-83.8.8-168.9 1.3-253.1 47.9 17 61.6 49.8 71.2 82.4 19.9-74.1-27.9-112.3-95.9-116.1z",
  }

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

  function categoryForTrack(track) {
    if (track.isPercussion) return "drums"
    const program = track.playbackInfo.program
    if (program <= 23) return "keys"
    if (program <= 31) return "guitar"
    if (program <= 39) return "bass"
    if (program <= 47) return "strings"
    if (program <= 55) return program >= 52 ? "vocals" : "strings"
    if (program <= 79) return "winds"
    if (program <= 103) return "synth"
    return "other"
  }

  function createTrackIcon() {
    const icon = document.createElementNS(SVG_NS, "svg")
    icon.setAttribute("class", "track-icon")
    icon.setAttribute("viewBox", "0 0 512 512")
    icon.setAttribute("width", "24")
    icon.setAttribute("height", "24")
    icon.setAttribute("fill", "currentColor")
    icon.appendChild(document.createElementNS(SVG_NS, "path"))
    return icon
  }

  function syncTrackIcon(scroll) {
    const track = window.api && window.api.tracks && window.api.tracks[0]
    if (!track) return
    const button = scroll.querySelector(".track-selector .button")
    if (!button) return
    let icon = button.querySelector(".track-icon")
    if (!icon) {
      icon = createTrackIcon()
      button.insertBefore(icon, button.firstChild)
    }
    const category = categoryForTrack(track)
    if (icon.dataset.category !== category) {
      icon.dataset.category = category
      icon.querySelector("path").setAttribute("d", INSTRUMENT_ICONS[category])
    }
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
