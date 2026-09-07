"use strict"

// Phone layout for the bottom toolbar (`div.toolbar > div.scroll`, upstream flex row with horizontal scroll). Below 640px width the row wraps, via flexbox `order` rather than DOM reordering: Play and the three toggle buttons (Loop, Count in, Metronome) first, then the track/audio selectors, then the speed menu button, then Edit (only present when logged in), each group dropping to its own line once it no longer fits — the toolbar's own height goes from a fixed 44px to auto so it can grow with the wrapped content. The toolbar is `position: fixed` at the viewport bottom (upstream, unchanged here) and now taller than the desktop 44px, so `.main` (the score's containing block) gets bottom padding to match, or the fixed toolbar would permanently cover the tail of a scrolled-to-the-end score. The navbar's own right padding is shrunk to match on phones (`.mobile .my-navbar .toolbar[data-v-8f474ce9]{padding:0 0 0 10px}` upstream drops it entirely).
//
// Play, Loop, Count in and Metronome are square icon-only buttons at every width, not just on phones, since the icon-plus-text pills left too little room once four of them share a row with the track/audio selectors on a 390px screen. Play morphs a play triangle into two pause bars via `clip-path` transitions on `::before`/`::after` instead of swapping FontAwesome icons, so the shape change animates; Loop/Count in/Metronome each get a small stroke SVG icon (`TOGGLE_ICONS`, via `createStrokeIcon`) and, like Play, show their active state as a filled background rather than an icon tint, so all four toolbar toggles read the same way at 44px instead of Play alone standing out. `syncToggleButtons` derives which toggle a button is from its own text content (`Loop`/`Count in`/`Metronome`, the same static text Vue renders) rather than tracking component state directly, for the same DOM-scraping reason `categoryForTrack`/`syncTrackIcon` do — there is no stable class or attribute upstream to key off. The buttons keep upstream's own `.active`/`.disabled` classes (Metronome disables itself when the audio source isn't the synth); only the visual treatment changes.
//
// Upstream's speed control (`div.select-percentage`, a plain number input in the toolbar) is hidden at every width and replaced with a split control: a percentage button that toggles playback between 100% and the last non-100% speed on a single tap, paired with a caret button that opens a menu with a slider and a number field, since a fixed set of presets does not cover the full 20-200% range usefully and most sessions only ever alternate between full speed and one practice speed. The control and menu are DOM elements this script creates and maintains itself, since the toolbar is re-rendered by Vue on every tab navigation: a poll every 500ms re-creates the control if missing and re-binds it to the (possibly new) upstream input, and removes it again only once the toolbar itself disappears. Applying a speed writes to the upstream input and dispatches native `input`/`change` events on it, which is what the Vue binding listens for; the upstream watcher clamps values below 20 to 20, so this addon clamps to the same [20, 200] range. The hide rule for the upstream input is scoped to `.toolbar .scroll .select-percentage` because the same `select-percentage` class is reused by the per-track volume input elsewhere in the UI, which must stay visible. The menu opens above the speed control and stays inside the viewport: full width on phones, anchored to the control's left edge (clamped to the viewport) on desktop.
//
// At every width, the track-selector button also gets a small inline SVG icon inserted before the (phone-hidden) name span, picked from the current track's MIDI program via a fixed category map (percussion checked first, since drum tracks report program 0 like a piano; see `categoryForTrack`). On phones this is the only visible content, since the name text is hidden via CSS; on desktop the icon sits to the left of the visible name for consistency with the rest of the toolbar. The dropdown list itself keeps the full track names. The button may be re-created by Vue, so the icon is re-inserted whenever it is missing, the same way the speed button handles re-creation.
//
// Audio list rows (`.audio-list .item`) get the same treatment: an icon derived from the row's own visible text (`Synth`, `Youtube: …`, `No Audio…`, or a filename) via `audioRowKey`, inserted once per row (guarded via `dataset.enhanced`) the same way track list rows get their icon in `enhanceLists`.
//
// Icon path data (`INSTRUMENT_ICONS`, `AUDIO_ICONS`) is taken from the game-icons.net set by Delapouite, Caro Asercion, Zajkonur and Skoll, licensed CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/). The toggle-button and speed-menu-caret icons (`TOGGLE_ICONS`) are taken from Tabler Icons (https://tabler.io), MIT licensed, built through the same `createStrokeIcon` helper since that set's 24×24 outline glyphs already match its viewBox, stroke width and round caps/joins.
//
// The tab list page marks tabs that have a render (`hasRender`, added server-side) with a small icon after the title: the Dockerfile patch gives the title element a `has-render` class instead of appending a plain emoji, and the CSS here paints a `::after` pseudo-element masked to `AUDIO_ICONS.file`'s own path data through a data-URI (`maskUrl`), since a stylesheet has no other way to reach that path data.
//
// The Solo/Mute buttons in the track sheet (`.list-button.solo`/`.mute`) collapse to single-letter `S`/`M` chips (via `::before`; the row's own `Solo`/`Mute` text is hidden with `font-size: 0`) at every width, coloured when active, since spelling both words out left too little room for the track name once the sheet is this narrow; the sheet's close glyph shrinks with it (still a 44×44 tap target, just a smaller icon inside) to match. Hover backgrounds on these chips and on the list row itself are dropped under `@media (hover: none)`, since a touch "hover" on such a device is really the tap itself and never clears until something else is tapped, leaving a chip visibly stuck highlighted after use.
//
// Solo and Mute are reimplemented by this addon instead of left to the upstream Vue component: upstream's own `toggleSolo` mutes every other track directly rather than calling alphaTab's own `changeTrackSolo`, which means only one track can ever be soloed and the synth's own per-channel solo state is never actually touched. This addon intercepts the chip clicks in the capture phase (before Vue's own `onClick` fires on the same element) and tracks solo/mute per track index in its own two `Set`s, replaying them through `api.changeTrackSolo`/`api.changeTrackMute` so multiple tracks can be soloed at once. The synth recreates its whole channel graph on every audio-source switch (Synth ↔ Render ↔ YouTube), which drops all channel state including solo/mute, so this addon re-applies its two `Set`s on every `api.playerReady` event, not just once at startup. Solo/Mute only affect the synth's own channels, so with an external audio source (Render, YouTube, an uploaded file) they have no audible effect; the chips and the volume knobs are dimmed and given an explanatory title in that state, while the underlying `Set`s are kept so they take effect again once the Synth source is reselected. The chips are focusable (`tabindex=0`, Enter/Space toggle them) and show focus as an outline ring; hover never changes their background beyond the neutral grey.
//
// `.toolbar`, its open list, the speed menu and the score container get `touch-action: manipulation` under `@media (pointer: coarse)`, so a double-tap on any of these controls fires its own click handler instead of the browser's double-tap-to-zoom. The volume knob's own `touch-action: none` still wins over it there, since `touch-action` is not inherited but the effective value browsers use is the intersection of an element and its ancestors, and `none` is the more restrictive of the two.
//
// The track and audio dropdowns (`.track-list.list`, `.audio-list.list`) are Vue `v-if` children of `.toolbar`, torn down and rebuilt from scratch every time they open; `.toolbar` itself has `backdrop-filter`, which makes it the CSS containing block for any `position: fixed` descendant, so a sheet positioned that way would anchor to the toolbar's own box instead of the viewport — this addon keeps upstream's `position: absolute` on `.list` and just widens it to `left:0;right:0;bottom:100%`, which anchors correctly against the toolbar (a viewport-height, viewport-width strip) without fighting that containing-block behaviour; the sheet does not lock body scroll while open, relying on its own `max-height` clamp and `overscroll-behavior: contain` to keep an over-scroll at the top or bottom of the list from bubbling into the page underneath.
//
// Each row of the track list gets a small instrument icon and the track's own name from `api.score.tracks` (row position equals track index), applied by a `MutationObserver` on `.toolbar`'s direct children rather than the polling loop used elsewhere in this file, since the whole list subtree is replaced on every open and a timer would either miss it or double up; the icon is inserted as a sibling of `.name`, never inside it, because Vue's own text-patching would wipe out anything placed as a child of that element on its next update.
//
// The per-track volume input becomes an SVG dial: drag vertically or use the arrow keys to change it, double-click to reset to 100%; dragging draws locally on every pointer move but only writes through to the upstream input (native setter plus `input`/`change` events, which is what the Vue binding listens for) once per animation frame, and on release. The addon keeps its own last-set-value-per-track map because the upstream input itself is re-created at 100% every time the list is reopened, while the actual gain the synth is using stays wherever it was left; that map is what re-seeds the dial (and the hidden input) on the next open.
//
// A double-click resets the knob to 100% for mouse users, but touch screens do not reliably synthesize `dblclick` from two taps, so the knob also recognizes its own double-tap: two `pointerdown` events within 300ms and 10px of each other, with no drag in between, reset the value the same way. `setPointerCapture` is wrapped in try/catch since synthetic pointer events (as used in tests) throw on it.
//
// The Audio button gets an icon and a text label mirroring the current source (Synth / Backing / YouTube / Muted / the render or upload filename), read off the Vue component instance's `currentAudio` field rather than scraped from the DOM, since the button itself carries no indication of which source is active; the component instance is found once by walking the app's internal vnode tree (there is no public API for it) and cached, re-found only if the cached reference stops resolving to a live component. The track sheet reads the same `currentAudio` field to dim the Solo/Mute chips and mark `.track-list` with `data-external-audio` whenever the source isn't the synth, since those controls have no audible effect otherwise; in that state the Clear solo button is swapped for an `.external-audio-notice` explaining why, both toggled together in `syncTrackRowStates`.
//
// The tab page's own scoped stylesheet is a separate chunk that Vue's router lazy-loads only once that route mounts, so it lands in `<head>` after this script's own `<style>` element (inserted at the very first tick, before navigation); at equal CSS specificity the later stylesheet wins, which flips several of the sheet-position overrides below back to upstream's desktop layout. Every tick re-appends this script's `<style>` element to the end of `<head>` if something has been added after it, which keeps it winning ties against that chunk (and any other stylesheet loaded later) without inflating selectors with specificity hacks.
//
// oxfmt (0.2.0) hoists any comment placed directly before a declaration out of its enclosing function, so this file keeps explanatory comments here in the header instead of inline.
;(function () {
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

  const AUDIO_ICONS = {
    file: INSTRUMENT_ICONS.synth,
    synth: INSTRUMENT_ICONS.keys,
    youtube: "M144 80v352l288-176z",
    none: "M40 192h88l112-88v304l-112-88H40zM300 350L450 200L480 230L330 380Z",
  }

  const TOGGLE_ICONS = {
    loop: "M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3 M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3",
    countin:
      "M6.5 7h11 M6.5 17h11 M6 20v-2a6 6 0 1 1 12 0v2a1 1 0 0 1 -1 1h-10a1 1 0 0 1 -1 -1 M6 4v2a6 6 0 1 0 12 0v-2a1 1 0 0 0 -1 -1h-10a1 1 0 0 0 -1 1",
    metronome:
      "M14.153 8.188l-.72 -3.236a2.493 2.493 0 0 0 -4.867 0l-3.025 13.614a2 2 0 0 0 1.952 2.434h7.014a2 2 0 0 0 1.952 -2.434l-.524 -2.357m-4.935 1.791l9 -13 M19 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
    caret: "M6 15l6 -6l6 6",
  }

  function maskUrl(pathData) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="${pathData}"/></svg>`
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
  }

  const TAB_ICON_MASK = maskUrl(AUDIO_ICONS.file)

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
.toolbar .list {
	overscroll-behavior: contain;
}
.toolbar .track-list .track .track-row-icon {
	width: 20px;
	height: 20px;
	flex: 0 0 20px;
	margin-left: 14px;
}
.toolbar .track-list .track .list-button.select-percentage {
	font-size: 0;
	background: none;
}
.toolbar .track-list .track .list-button.select-percentage input {
	display: none;
}
.toolbar .track-list .track .list-button.solo,
.toolbar .track-list .track .list-button.mute {
	font-size: 0;
	flex: 0 0 34px;
	width: 34px;
	height: 34px;
	padding: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	border-right: 0;
	border-radius: 6px;
}
.toolbar .track-list .track .list-button.solo::before {
	content: "S";
	font-size: 15px;
	font-weight: 700;
}
.toolbar .track-list .track .list-button.mute::before {
	content: "M";
	font-size: 15px;
	font-weight: 700;
}
.toolbar .track-list .track[data-solo="1"] .list-button.solo {
	background-color: #ffc107;
	color: #212529;
}
.toolbar .track-list .track[data-mute="1"] .list-button.mute {
	background-color: #dc3545;
	color: #fff;
}
.toolbar .track-list .track .list-button.active {
	background-color: #49535a;
}
.toolbar .track-list[data-external-audio="1"] .list-button.solo,
.toolbar .track-list[data-external-audio="1"] .list-button.mute,
.toolbar .track-list[data-external-audio="1"] .volume-knob {
	opacity: 0.4;
	pointer-events: none;
}
.toolbar .track-list .track .list-button.solo:hover,
.toolbar .track-list .track .list-button.mute:hover {
	background-color: #49535a;
}
.toolbar .track-list .track[data-solo="1"] .list-button.solo:hover {
	background-color: #ffc107;
}
.toolbar .track-list .track[data-mute="1"] .list-button.mute:hover {
	background-color: #dc3545;
}
.toolbar .track-list .track .list-button.solo:focus-visible,
.toolbar .track-list .track .list-button.mute:focus-visible {
	outline: 2px solid #fff;
	outline-offset: 2px;
}
@media (hover: none) {
	.toolbar .track-list .track .list-button.solo:hover,
	.toolbar .track-list .track .list-button.mute:hover {
		background-color: #49535a;
	}
	.toolbar .track-list .track .list-button.select-percentage:hover {
		background: none;
	}
	.toolbar .list .item .name:hover {
		background-color: transparent;
	}
}
@media (pointer: coarse) {
	.toolbar,
	.toolbar .list,
	.speed-menu,
	.alphaTab {
		touch-action: manipulation;
	}
}
.volume-knob {
	font-size: 11px;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 1px;
	width: 52px;
	touch-action: none;
	user-select: none;
	cursor: ns-resize;
}
.toolbar .scroll .audio-selector .button {
	font-size: 0;
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 96px;
	justify-content: center;
}
.audio-icon {
	width: 20px;
	height: 20px;
	flex: 0 0 20px;
}
.audio-label {
	font-size: 14px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	max-width: 72px;
}
.toolbar .audio-list .item .audio-row-icon {
	width: 20px;
	height: 20px;
	flex: 0 0 20px;
	margin-left: 14px;
}
.tab-item .info .title.has-render::after {
	content: "";
	display: inline-block;
	width: 14px;
	height: 14px;
	margin-left: 6px;
	vertical-align: -2px;
	background-color: currentColor;
	opacity: 0.7;
	-webkit-mask: ${TAB_ICON_MASK} center/contain no-repeat;
	mask: ${TAB_ICON_MASK} center/contain no-repeat;
}
.toolbar .scroll button.btn-primary {
	--bs-btn-bg: #6c757d;
	--bs-btn-border-color: #6c757d;
	--bs-btn-hover-bg: #5c636a;
	--bs-btn-hover-border-color: #565e64;
	--bs-btn-active-bg: #565e64;
	--bs-btn-active-border-color: #51585e;
	font-size: 0;
	flex: 0 0 44px;
	width: 44px;
	min-width: 44px;
	padding: 0;
	position: relative;
}
.toolbar .scroll button.btn-primary::before,
.toolbar .scroll button.btn-primary::after {
	content: "";
	position: absolute;
	top: 50%;
	margin-top: -10px;
	width: 9px;
	height: 20px;
	background: currentColor;
	transition: clip-path 180ms ease;
}
.toolbar .scroll button.btn-primary::before {
	left: calc(50% - 9px);
	clip-path: polygon(0 0, 100% 25%, 100% 75%, 0 100%);
}
.toolbar .scroll button.btn-primary::after {
	left: 50%;
	clip-path: polygon(0 25%, 100% 50%, 100% 50%, 0 75%);
}
.toolbar .scroll button.btn-primary.active::before {
	clip-path: polygon(0 0, 78% 0, 78% 100%, 0 100%);
}
.toolbar .scroll button.btn-primary.active::after {
	clip-path: polygon(22% 0, 100% 0, 100% 100%, 22% 100%);
}
.toolbar .scroll button.btn-primary.active {
	--bs-btn-bg: #3131c6;
	--bs-btn-border-color: #3131c6;
	--bs-btn-hover-bg: #3131c6;
	--bs-btn-hover-border-color: #3131c6;
	--bs-btn-active-bg: #3131c6;
	--bs-btn-active-border-color: #3131c6;
	--bs-btn-active-color: #fff;
	--bs-btn-hover-color: #fff;
}
.toolbar .scroll button.btn-primary > span svg {
	display: none;
}
.toolbar .scroll > button.btn-secondary[data-toggle-icon] {
	font-size: 0;
	flex: 0 0 44px;
	width: 44px;
	min-width: 44px;
	padding: 0;
	display: flex;
	align-items: center;
	justify-content: center;
}
.toolbar .scroll > button.btn-secondary[data-toggle-icon] .toggle-icon {
	width: 24px;
	height: 24px;
	color: #adb5bd;
}
.toolbar .scroll > button.btn-secondary[data-toggle-icon] > svg:not(.toggle-icon) {
	display: none;
}
.toolbar .scroll > button.btn-secondary[data-toggle-icon].active .toggle-icon {
	color: #fff;
}
.toolbar .scroll > button.btn-secondary[data-toggle-icon="loop"].active {
	--bs-btn-bg: #198754;
	--bs-btn-border-color: #198754;
	--bs-btn-hover-bg: #198754;
	--bs-btn-hover-border-color: #198754;
	--bs-btn-active-bg: #198754;
	--bs-btn-active-border-color: #198754;
	--bs-btn-active-color: #fff;
	--bs-btn-hover-color: #fff;
}
.toolbar .scroll > button.btn-secondary[data-toggle-icon="countin"].active {
	--bs-btn-bg: #ca6510;
	--bs-btn-border-color: #ca6510;
	--bs-btn-hover-bg: #ca6510;
	--bs-btn-hover-border-color: #ca6510;
	--bs-btn-active-bg: #ca6510;
	--bs-btn-active-border-color: #ca6510;
	--bs-btn-active-color: #fff;
	--bs-btn-hover-color: #fff;
}
.toolbar .scroll > button.btn-secondary[data-toggle-icon="metronome"].active {
	--bs-btn-bg: #087990;
	--bs-btn-border-color: #087990;
	--bs-btn-hover-bg: #087990;
	--bs-btn-hover-border-color: #087990;
	--bs-btn-active-bg: #087990;
	--bs-btn-active-border-color: #087990;
	--bs-btn-active-color: #fff;
	--bs-btn-hover-color: #fff;
}
.toolbar .scroll button.btn-secondary.disabled {
	opacity: 0.5;
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
.speed-control .btn {
	height: 44px;
	min-height: 44px;
}
.speed-toggle-btn {
	min-width: 62px;
}
.speed-caret-btn {
	width: 34px;
	min-width: 34px;
	padding: 0;
}
.speed-control.speed-on .btn {
	--bs-btn-bg: #3131c6;
	--bs-btn-border-color: #3131c6;
	--bs-btn-hover-bg: #2a2aa8;
	--bs-btn-hover-border-color: #2a2aa8;
	--bs-btn-active-bg: #2a2aa8;
	color: #fff;
}
.toolbar .track-list .list-header .clear-solo-btn {
	float: left;
	height: 34px;
	padding: 0 12px;
	font-size: 13px;
	background-color: #ffc107;
	color: #212529;
	border: 0;
	border-radius: 6px;
}
.toolbar .track-list .list-header .clear-solo-btn[hidden] {
	display: none;
}
.toolbar .track-list .list-header .external-audio-notice {
	float: left;
	height: 34px;
	line-height: 34px;
	font-size: 13px;
	color: #adb5bd;
}
.toolbar .track-list .list-header .external-audio-notice[hidden] {
	display: none;
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
	}
	.toolbar .scroll > button.btn-secondary {
		order: 2;
		position: static;
	}
	.toolbar .scroll .track-selector {
		order: 3;
	}
	.toolbar .scroll .audio-selector {
		order: 4;
	}
	.toolbar .scroll .speed-control {
		order: 6;
	}
	.toolbar .scroll .btn-edit {
		order: 7;
	}
	.toolbar .scroll .btn-edit button,
	.toolbar .scroll .speed-control {
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
	.toolbar .list {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 100%;
		width: auto;
		min-width: 0;
		max-height: 70vh;
		max-height: 70dvh;
		overflow-y: auto;
		border-radius: 12px 12px 0 0;
	}
	.toolbar .list .list-header {
		padding: 8px 10px;
	}
	.toolbar .list .list-header svg.close {
		width: 18px;
		height: 18px;
		padding: 13px;
		box-sizing: content-box;
		margin: -4px;
	}
	.toolbar .list .item {
		min-height: 60px;
		column-gap: 8px;
	}
	.toolbar .list .item .name {
		padding: 10px 0;
		border-right: 0;
		font-size: 14px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.toolbar .audio-list .item .audio-row-icon {
		margin-left: 10px;
	}
	.toolbar .track-list .track .track-row-icon {
		margin-left: 10px;
	}
	.toolbar .track-list .track .list-button.select-percentage {
		display: flex;
		align-items: center;
		height: auto;
		padding: 0 10px 0 0;
		border-right: 0;
		border-radius: 6px;
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
  const KNOB_MIN = 0
  const KNOB_MAX = 200
  const KNOB_DEFAULT = 100
  const KNOB_PIXELS_PER_PERCENT = 2
  const KNOB_ARC_RADIUS = 16
  const KNOB_INDICATOR_INNER_RADIUS = 6.75
  const KNOB_INDICATOR_OUTER_RADIUS = 14.25
  const KNOB_STEP = 5
  const KNOB_DOUBLE_TAP_MS = 300
  const KNOB_DOUBLE_TAP_PX = 10
  const DEFAULT_SLOW_SPEED = 70

  const nativeValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set

  let speedControl = null
  let toggleButton = null
  let caretButton = null
  let rememberedSpeed = DEFAULT_SLOW_SPEED
  let menuElement = null
  let sliderInput = null
  let valueInput = null
  let boundInput = null
  let observedToolbar = null
  let vueProxy = null
  let observedApi = null
  let observedScore = null
  const SOLO_MUTE_CHIP_SELECTOR =
    ".toolbar .track-list .track .list-button.solo, .toolbar .track-list .track .list-button.mute"
  const soloTracks = new Set()
  const mutedTracks = new Set()
  const volumeByTrack = new Map()
  const listObserver = new MutationObserver(enhanceLists)

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
    const speed = currentSpeed()
    if (toggleButton) toggleButton.textContent = `${speed}%`
    if (speed !== 100) rememberedSpeed = speed
    if (speedControl) speedControl.classList.toggle("speed-on", speed !== 100)
    if (toggleButton)
      toggleButton.setAttribute("aria-pressed", String(speed !== 100))
    if (caretButton)
      caretButton.setAttribute(
        "aria-expanded",
        String(Boolean(menuElement) && !menuElement.hidden),
      )
  }

  function toggleSpeed() {
    const speed = currentSpeed()
    if (speed === 100) applySpeed(rememberedSpeed)
    else {
      rememberedSpeed = speed
      applySpeed(100)
    }
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
    positionMenu(speedControl.getBoundingClientRect())
    syncMenuInputs(currentSpeed())
    menuElement.hidden = false
    syncLabel()
  }

  function closeMenu() {
    if (!menuElement) return
    menuElement.hidden = true
    syncLabel()
  }

  function toggleMenu() {
    if (menuElement.hidden) openMenu()
    else closeMenu()
  }

  function createSpeedControl(scroll) {
    const group = document.createElement("div")
    group.className = "btn-group speed-control"

    const toggle = document.createElement("button")
    toggle.type = "button"
    toggle.className = "btn btn-secondary speed-toggle-btn"
    toggle.textContent = "100%"
    toggle.setAttribute("aria-label", "Toggle playback speed")

    const caret = document.createElement("button")
    caret.type = "button"
    caret.className = "btn btn-secondary speed-caret-btn"
    caret.setAttribute("aria-haspopup", "dialog")
    caret.setAttribute("aria-label", "Open playback speed menu")
    const caretIcon = createStrokeIcon("toggle-icon")
    caret.appendChild(caretIcon)
    applyIconCategory(caretIcon, TOGGLE_ICONS, "caret")

    const reference = scroll.querySelector("button.btn")
    if (reference) {
      for (const attribute of reference.attributes) {
        if (attribute.name.startsWith("data-v-")) {
          toggle.setAttribute(attribute.name, attribute.value)
          caret.setAttribute(attribute.name, attribute.value)
        }
      }
    }
    toggle.addEventListener("click", (event) => {
      event.stopPropagation()
      toggleSpeed()
    })
    caret.addEventListener("click", (event) => {
      event.stopPropagation()
      toggleMenu()
    })

    group.append(toggle, caret)
    const percentageInput = scroll.querySelector(".select-percentage")
    if (percentageInput) scroll.insertBefore(group, percentageInput)
    else scroll.appendChild(group)

    toggleButton = toggle
    caretButton = caret
    return group
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
    if (speedControl) speedControl.remove()
    if (menuElement) menuElement.remove()
    speedControl = null
    toggleButton = null
    caretButton = null
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

  function createTrackIcon(className) {
    const icon = document.createElementNS(SVG_NS, "svg")
    icon.setAttribute("class", className)
    icon.setAttribute("viewBox", "0 0 512 512")
    icon.setAttribute("width", "24")
    icon.setAttribute("height", "24")
    icon.setAttribute("fill", "currentColor")
    icon.appendChild(document.createElementNS(SVG_NS, "path"))
    return icon
  }

  function createStrokeIcon(className) {
    const icon = document.createElementNS(SVG_NS, "svg")
    icon.setAttribute("class", className)
    icon.setAttribute("viewBox", "0 0 24 24")
    icon.setAttribute("width", "24")
    icon.setAttribute("height", "24")
    icon.setAttribute("fill", "none")
    icon.setAttribute("stroke", "currentColor")
    icon.setAttribute("stroke-width", "2")
    icon.setAttribute("stroke-linecap", "round")
    icon.setAttribute("stroke-linejoin", "round")
    icon.appendChild(document.createElementNS(SVG_NS, "path"))
    return icon
  }

  function applyIconCategory(icon, iconMap, category) {
    if (icon.dataset.category === category) return
    icon.dataset.category = category
    icon.querySelector("path").setAttribute("d", iconMap[category])
  }

  function syncTrackIcon(scroll) {
    const track = window.api && window.api.tracks && window.api.tracks[0]
    if (!track) return
    const button = scroll.querySelector(".track-selector .button")
    if (!button) return
    let icon = button.querySelector(".track-icon")
    if (!icon) {
      icon = createTrackIcon("track-icon")
      button.insertBefore(icon, button.firstChild)
    }
    applyIconCategory(icon, INSTRUMENT_ICONS, categoryForTrack(track))
  }

  function toggleKeyForLabel(label) {
    if (label === "Loop") return "loop"
    if (label === "Count in") return "countin"
    if (label === "Metronome") return "metronome"
    return null
  }

  function syncToggleButtons(scroll) {
    const playButton = scroll.querySelector("button.btn-primary")
    if (playButton) {
      playButton.setAttribute("aria-label", "Play/Pause")
      playButton.title = "Play/Pause"
    }
    scroll
      .querySelectorAll(":scope > button.btn-secondary")
      .forEach((button) => {
        const label = button.textContent.trim()
        const key = toggleKeyForLabel(label)
        if (!key) return
        button.dataset.toggleIcon = key
        button.setAttribute("aria-label", label)
        button.title = label
        let icon = button.querySelector(".toggle-icon")
        if (!icon) {
          icon = createStrokeIcon("toggle-icon")
          button.insertBefore(icon, button.firstChild)
        }
        applyIconCategory(icon, TOGGLE_ICONS, key)
      })
  }

  function audioIconKey(currentAudio) {
    if (currentAudio === "synth") return "synth"
    if (currentAudio === "none") return "none"
    if (currentAudio.startsWith("youtube-")) return "youtube"
    return "file"
  }

  function audioRowKey(name) {
    if (name === "Synth") return "synth"
    if (name.startsWith("Youtube: ")) return "youtube"
    if (name.startsWith("No Audio")) return "none"
    return "file"
  }

  function audioSourceLabel(currentAudio) {
    if (currentAudio === "synth") return "Synth"
    if (currentAudio === "backingTrack") return "Backing"
    if (currentAudio === "none") return "Muted"
    if (currentAudio.startsWith("youtube-")) return "YouTube"
    if (currentAudio === "audio-render.mp3") return "Render"
    if (currentAudio.startsWith("audio-")) {
      const filename = currentAudio.slice("audio-".length)
      const dotIndex = filename.lastIndexOf(".")
      return dotIndex > 0 ? filename.slice(0, dotIndex) : filename
    }
    return "Synth"
  }

  function findVueProxy() {
    const app = document.querySelector("#app")
    const root = app && app.__vue_app__ && app.__vue_app__._container._vnode
    if (!root) return null
    const stack = [root]
    while (stack.length) {
      const vnode = stack.pop()
      if (!vnode || typeof vnode !== "object") continue
      const proxy = vnode.component && vnode.component.proxy
      if (proxy && "api" in proxy && "audioList" in proxy) return proxy
      if (vnode.component && vnode.component.subTree)
        stack.push(vnode.component.subTree)
      if (Array.isArray(vnode.children)) stack.push(...vnode.children)
      else if (vnode.children) stack.push(vnode.children)
    }
    return null
  }

  function getVueProxy() {
    if (vueProxy && vueProxy.api !== undefined) return vueProxy
    vueProxy = findVueProxy()
    return vueProxy
  }

  function syncAudioLabel() {
    const button = document.querySelector(
      ".toolbar .scroll .audio-selector .button",
    )
    if (!button) return
    const proxy = getVueProxy()
    const currentAudio = proxy && proxy.currentAudio
    if (typeof currentAudio !== "string") return

    let icon = button.querySelector(".audio-icon")
    if (!icon) {
      icon = createTrackIcon("audio-icon")
      button.insertBefore(icon, button.firstChild)
    }
    let label = button.querySelector(".audio-label")
    if (!label) {
      label = document.createElement("span")
      label.className = "audio-label"
      button.appendChild(label)
    }

    if (button.dataset.audio === currentAudio) return
    button.dataset.audio = currentAudio
    applyIconCategory(icon, AUDIO_ICONS, audioIconKey(currentAudio))
    label.textContent = audioSourceLabel(currentAudio)
  }

  function knobAngle(percent) {
    return 225 + (270 * percent) / KNOB_MAX
  }

  function knobPoint(degrees, radius) {
    const radians = (degrees * Math.PI) / 180
    const x = 20 + radius * Math.sin(radians)
    const y = 20 - radius * Math.cos(radians)
    return [x, y]
  }

  function knobArcPath(fromPercent, toPercent, radius) {
    const [startX, startY] = knobPoint(knobAngle(fromPercent), radius)
    const [endX, endY] = knobPoint(knobAngle(toPercent), radius)
    const largeArc = knobAngle(toPercent) - knobAngle(fromPercent) > 180 ? 1 : 0
    return `M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY}`
  }

  function buildKnobSvg() {
    const svg = document.createElementNS(SVG_NS, "svg")
    svg.setAttribute("viewBox", "0 0 40 40")
    svg.setAttribute("width", "40")
    svg.setAttribute("height", "40")

    const trackArc = document.createElementNS(SVG_NS, "path")
    trackArc.setAttribute("fill", "none")
    trackArc.setAttribute("stroke", "#495057")
    trackArc.setAttribute("stroke-width", "4")
    trackArc.setAttribute("stroke-linecap", "round")
    trackArc.setAttribute("d", knobArcPath(KNOB_MIN, KNOB_MAX, KNOB_ARC_RADIUS))

    const valueArc = document.createElementNS(SVG_NS, "path")
    valueArc.setAttribute("fill", "none")
    valueArc.setAttribute("stroke", "#0d6efd")
    valueArc.setAttribute("stroke-width", "4")
    valueArc.setAttribute("stroke-linecap", "round")

    const indicator = document.createElementNS(SVG_NS, "line")
    indicator.setAttribute("stroke", "#fff")
    indicator.setAttribute("stroke-width", "3")
    indicator.setAttribute("stroke-linecap", "round")

    svg.append(trackArc, valueArc, indicator)
    return { svg, valueArc, indicator }
  }

  function drawKnob(parts, value) {
    parts.valueArc.setAttribute(
      "d",
      knobArcPath(KNOB_MIN, value, KNOB_ARC_RADIUS),
    )
    const angle = knobAngle(value)
    const [innerX, innerY] = knobPoint(angle, KNOB_INDICATOR_INNER_RADIUS)
    const [outerX, outerY] = knobPoint(angle, KNOB_INDICATOR_OUTER_RADIUS)
    parts.indicator.setAttribute("x1", String(innerX))
    parts.indicator.setAttribute("y1", String(innerY))
    parts.indicator.setAttribute("x2", String(outerX))
    parts.indicator.setAttribute("y2", String(outerY))
  }

  function createVolumeKnob(track, input) {
    const knob = document.createElement("div")
    knob.className = "volume-knob"
    knob.setAttribute("role", "slider")
    knob.setAttribute("tabindex", "0")
    knob.setAttribute("aria-valuemin", String(KNOB_MIN))
    knob.setAttribute("aria-valuemax", String(KNOB_MAX))
    knob.setAttribute("aria-label", track.name || `Track ${track.index + 1}`)

    const parts = buildKnobSvg()
    const label = document.createElement("span")
    knob.append(parts.svg, label)

    const setValue = (rawValue, dispatch) => {
      const clamped = Math.min(
        KNOB_MAX,
        Math.max(KNOB_MIN, Math.round(rawValue)),
      )
      drawKnob(parts, clamped)
      label.textContent = String(clamped)
      knob.setAttribute("aria-valuenow", String(clamped))
      volumeByTrack.set(track.index, clamped)
      if (dispatch) {
        nativeValueSetter.call(input, String(clamped))
        input.dispatchEvent(new Event("input", { bubbles: true }))
        input.dispatchEvent(new Event("change", { bubbles: true }))
      }
    }

    let activePointerId = null
    let dragStartY = 0
    let dragStartValue = KNOB_DEFAULT
    let pendingFrame = null
    let lastTapTime = 0
    let lastTapX = 0
    let lastTapY = 0
    let tapDragged = false

    const scheduleWrite = (value) => {
      if (pendingFrame) return
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = null
        setValue(value, true)
      })
    }

    const releasePointer = (event) => {
      if (event.pointerId !== activePointerId) return
      if (knob.hasPointerCapture(event.pointerId))
        knob.releasePointerCapture(event.pointerId)
      activePointerId = null
      if (pendingFrame) {
        cancelAnimationFrame(pendingFrame)
        pendingFrame = null
      }
      setValue(volumeByTrack.get(track.index) ?? KNOB_DEFAULT, true)
    }

    knob.addEventListener("pointerdown", (event) => {
      const now = Date.now()
      const isDoubleTap =
        now - lastTapTime < KNOB_DOUBLE_TAP_MS &&
        Math.abs(event.clientX - lastTapX) < KNOB_DOUBLE_TAP_PX &&
        Math.abs(event.clientY - lastTapY) < KNOB_DOUBLE_TAP_PX &&
        !tapDragged
      if (isDoubleTap) {
        setValue(KNOB_DEFAULT, true)
        lastTapTime = 0
        return
      }
      lastTapTime = now
      lastTapX = event.clientX
      lastTapY = event.clientY
      tapDragged = false
      try {
        knob.setPointerCapture(event.pointerId)
      } catch {}
      activePointerId = event.pointerId
      dragStartY = event.clientY
      dragStartValue = volumeByTrack.get(track.index) ?? KNOB_DEFAULT
    })
    knob.addEventListener("pointermove", (event) => {
      if (event.pointerId !== activePointerId) return
      if (
        Math.abs(event.clientX - lastTapX) > KNOB_DOUBLE_TAP_PX ||
        Math.abs(event.clientY - lastTapY) > KNOB_DOUBLE_TAP_PX
      )
        tapDragged = true
      const value =
        dragStartValue + (dragStartY - event.clientY) / KNOB_PIXELS_PER_PERCENT
      setValue(value, false)
      scheduleWrite(value)
    })
    knob.addEventListener("pointerup", releasePointer)
    knob.addEventListener("pointercancel", releasePointer)
    knob.addEventListener("dblclick", () => setValue(KNOB_DEFAULT, true))
    knob.addEventListener("keydown", (event) => {
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setValue(
          (volumeByTrack.get(track.index) ?? KNOB_DEFAULT) + KNOB_STEP,
          true,
        )
      } else if (event.key === "ArrowDown") {
        event.preventDefault()
        setValue(
          (volumeByTrack.get(track.index) ?? KNOB_DEFAULT) - KNOB_STEP,
          true,
        )
      }
    })

    const redrawFromInput = () => {
      const value = Number(input.value)
      if (value !== volumeByTrack.get(track.index)) setValue(value, false)
    }
    input.addEventListener("input", redrawFromInput)
    input.addEventListener("change", redrawFromInput)

    const seeded = volumeByTrack.get(track.index) ?? KNOB_DEFAULT
    nativeValueSetter.call(input, String(seeded))
    setValue(seeded, false)

    return knob
  }

  function insertRowIcon(row, track) {
    const icon = createTrackIcon("track-row-icon")
    row.insertBefore(icon, row.firstChild)
    applyIconCategory(icon, INSTRUMENT_ICONS, categoryForTrack(track))
  }

  function applyTrackName(row, track) {
    const nameNode = row.querySelector(".name")
    if (!nameNode || !track.name) return
    if (
      row.dataset.trackName === track.name &&
      nameNode.textContent === track.name
    )
      return
    nameNode.textContent = track.name
    row.dataset.trackName = track.name
  }

  function insertVolumeKnob(row, track) {
    const container = row.querySelector(".list-button.select-percentage")
    const input = container && container.querySelector("input[type=number]")
    if (!container || !input) return
    container.appendChild(createVolumeKnob(track, input))
  }

  function insertAudioRowIcon(row) {
    const nameNode = row.querySelector(".name")
    if (!nameNode) return
    const icon = createTrackIcon("audio-row-icon")
    row.insertBefore(icon, row.firstChild)
    applyIconCategory(
      icon,
      AUDIO_ICONS,
      audioRowKey(nameNode.textContent.trim()),
    )
  }

  function applyTrackStates() {
    const api = window.api
    if (!api || !api.score) return
    const tracks = api.score.tracks
    api.changeTrackSolo(tracks, false)
    api.changeTrackMute(tracks, false)
    const soloed = tracks.filter((track) => soloTracks.has(track.index))
    if (soloed.length) api.changeTrackSolo(soloed, true)
    const muted = tracks.filter((track) => mutedTracks.has(track.index))
    if (muted.length) api.changeTrackMute(muted, true)
  }

  function clearSolo() {
    soloTracks.clear()
    applyTrackStates()
    syncTrackRowStates()
  }

  function ensureClearSoloButton() {
    const header = document.querySelector(".toolbar .track-list .list-header")
    if (!header) return null
    const existing = header.querySelector(".clear-solo-btn")
    if (existing) return existing
    const button = document.createElement("button")
    button.type = "button"
    button.className = "clear-solo-btn"
    button.textContent = "Clear solo"
    button.addEventListener("click", clearSolo)
    header.insertBefore(button, header.firstChild)
    return button
  }

  function ensureExternalAudioNotice() {
    const header = document.querySelector(".toolbar .track-list .list-header")
    if (!header) return null
    const existing = header.querySelector(".external-audio-notice")
    if (existing) return existing
    const notice = document.createElement("span")
    notice.className = "external-audio-notice"
    notice.textContent = "Cannot control tracks of rendered audio"
    header.insertBefore(notice, header.firstChild)
    return notice
  }

  function syncTrackRowStates() {
    document
      .querySelectorAll(".toolbar .track-list .track.item")
      .forEach((row) => {
        const trackIndex = Number(row.dataset.trackIndex)
        if (soloTracks.has(trackIndex)) row.dataset.solo = "1"
        else delete row.dataset.solo
        if (mutedTracks.has(trackIndex)) row.dataset.mute = "1"
        else delete row.dataset.mute
      })
    const trackList = document.querySelector(".toolbar .track-list")
    const isExternal = Boolean(
      trackList && trackList.dataset.externalAudio === "1",
    )
    const clearButton = ensureClearSoloButton()
    if (clearButton) clearButton.hidden = isExternal || soloTracks.size < 2
    const notice = ensureExternalAudioNotice()
    if (notice) notice.hidden = !isExternal
  }

  function syncTrackListAudioState() {
    const trackList = document.querySelector(".toolbar .track-list")
    if (!trackList) return
    const proxy = getVueProxy()
    const currentAudio = proxy && proxy.currentAudio
    const isExternal =
      typeof currentAudio === "string" && currentAudio !== "synth"
    if (isExternal) trackList.dataset.externalAudio = "1"
    else delete trackList.dataset.externalAudio
    trackList
      .querySelectorAll(".list-button.solo, .list-button.mute")
      .forEach((button) => {
        if (isExternal)
          button.title = "Solo/Mute work with the Synth audio source"
        else button.removeAttribute("title")
      })
    syncTrackRowStates()
  }

  function enhanceLists() {
    document
      .querySelectorAll(".toolbar .track-list .track.item")
      .forEach((row, index) => {
        const track =
          window.api && window.api.score && window.api.score.tracks[index]
        if (!track) return
        row.dataset.trackIndex = String(track.index)
        row
          .querySelectorAll(".list-button.solo, .list-button.mute")
          .forEach((chip) => {
            chip.tabIndex = 0
          })
        if (row.dataset.enhanced !== "1") {
          row.dataset.enhanced = "1"
          insertRowIcon(row, track)
          insertVolumeKnob(row, track)
        }
        applyTrackName(row, track)
      })
    syncTrackRowStates()
    document.querySelectorAll(".toolbar .audio-list .item").forEach((row) => {
      if (row.dataset.enhanced === "1") return
      row.dataset.enhanced = "1"
      insertAudioRowIcon(row)
    })
  }

  function tick() {
    if (document.head.lastElementChild !== style)
      document.head.appendChild(style)

    const scroll = findScroll()
    const toolbar = scroll && scroll.closest(".toolbar")
    if (!scroll || !toolbar) {
      removeSpeedUi()
      if (observedToolbar) {
        listObserver.disconnect()
        observedToolbar = null
      }
      return
    }

    if (!menuElement || !document.body.contains(menuElement))
      menuElement = createMenu()
    if (!speedControl || !scroll.contains(speedControl))
      speedControl = createSpeedControl(scroll)

    const input = findUpstreamInput(scroll)
    if (input && input !== boundInput) bindUpstreamInput(input)
    syncLabel()
    syncTrackIcon(scroll)
    syncToggleButtons(scroll)

    if (window.api !== observedApi) {
      observedApi = window.api
      if (observedApi) observedApi.playerReady.on(applyTrackStates)
    }
    if (window.api && window.api.score !== observedScore) {
      observedScore = window.api.score
      soloTracks.clear()
      mutedTracks.clear()
      applyTrackStates()
    }

    if (toolbar !== observedToolbar) {
      listObserver.disconnect()
      listObserver.observe(toolbar, { childList: true })
      observedToolbar = toolbar
      enhanceLists()
    }

    syncAudioLabel()
    syncTrackListAudioState()
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return
    const chip = event.target.closest?.(SOLO_MUTE_CHIP_SELECTOR)
    if (!chip) return
    event.preventDefault()
    chip.click()
  })

  document.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest(SOLO_MUTE_CHIP_SELECTOR)
      if (!button) return
      event.stopPropagation()
      const row = button.closest(".track.item")
      const trackIndex = Number(row.dataset.trackIndex)
      const trackSet = button.classList.contains("solo")
        ? soloTracks
        : mutedTracks
      if (trackSet.has(trackIndex)) trackSet.delete(trackIndex)
      else trackSet.add(trackIndex)
      applyTrackStates()
      syncTrackRowStates()
    },
    true,
  )
  document.addEventListener("click", (event) => {
    if (!menuElement || menuElement.hidden) return
    if (
      menuElement.contains(event.target) ||
      speedControl.contains(event.target)
    )
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
