"use strict"

// Phone layout for the bottom toolbar (`div.toolbar > div.scroll`, upstream flex row with
// horizontal scroll). Below 640px width the row wraps, via flexbox `order` rather than DOM
// reordering: Play and the three switch buttons (Loop, Count in, Metronome) first, then the
// track/audio selectors, then the speed input, each group dropping to its own line once it no
// longer fits — the toolbar's own height goes from a fixed 44px to auto so it can grow with the
// wrapped content. The switch buttons additionally get an iOS-style toggle knob drawn with
// `::before`/`::after` instead of upstream's plain `.active` background, since the compact wrapped
// row leaves little room for a text-only active state; their padding/gap/font-size are shrunk from
// desktop so Play plus all three switches fit on one line at a 390px viewport. The toolbar is
// `position: fixed` at the viewport bottom (upstream, unchanged here) and now taller than the
// desktop 44px, so `.main` (the score's containing block) gets bottom padding to match, or the
// fixed toolbar would permanently cover the tail of a scrolled-to-the-end score. oxfmt (0.2.0)
// hoists any comment placed directly before a declaration out of its enclosing function, so this
// file keeps explanatory comments here in the header instead of inline.
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
	}
	.toolbar .scroll .track-selector {
		order: 3;
	}
	.toolbar .scroll .audio-selector {
		order: 4;
	}
	.toolbar .scroll .select-percentage {
		order: 5;
	}
	.toolbar .scroll button.btn-secondary {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 3px 4px;
		font-size: 11px;
	}
	.toolbar .scroll button.btn-secondary::before {
		content: "";
		flex: 0 0 24px;
		width: 24px;
		height: 14px;
		border-radius: 7px;
		background: #6c757d;
		transition: background-color 150ms ease;
	}
	.toolbar .scroll button.btn-secondary::after {
		content: "";
		position: absolute;
		left: 7px;
		top: 50%;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #fff;
		transform: translate(0, -50%);
		transition: transform 150ms ease;
	}
	.toolbar .scroll button.btn-secondary.active::before {
		background: #198754;
	}
	.toolbar .scroll button.btn-secondary.active::after {
		transform: translate(10px, -50%);
	}
	.toolbar .scroll button.btn-secondary.disabled {
		opacity: 0.5;
	}
	.toolbar .scroll .select-percentage {
		flex: 0 1 auto;
		white-space: nowrap;
	}
	.toolbar .scroll .select-percentage input.form-control {
		width: 64px;
		flex: 0 0 64px;
		padding-left: 4px;
		padding-right: 4px;
	}
}
`
  document.head.appendChild(style)
})()
