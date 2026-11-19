/**
 * One Reading view's margin: whether notes float beside the text (making room
 * if needed) or open as popovers, shortening crowded notes, and hover.
 */
import { Component } from 'obsidian';
import type { MarginaliaSettings } from '../settings';
import { highlights } from '../render/highlights';
import { liftedTo } from './render';

const GAP = 32; // between the text and the notes
const EDGE = 20; // between the notes and the pane edge
const MIN_TEXT = 420; // narrowest the text gets to make room for the margin
/** How far a note may sit below its passage before the one above it is shortened. */
const DRIFT = 12;
/** Between a passage's last line and its popover (clears the underline). */
const BELOW = 12;

export const MODES = ['mg-reading', 'mg-r-margin', 'mg-r-narrow', 'mg-r-reserve'];

export interface LayoutHooks {
	settings(): MarginaliaSettings;
}

export class ReadingLayout extends Component {
	private observer: ResizeObserver;
	private width = -1;
	private hovered: string | null = null;
	private frames = { pass: 0, hover: 0 };

	constructor(
		/** `.markdown-reading-view` */
		readonly container: HTMLElement,
		/** `.markdown-preview-view`, the scroller */
		readonly scroller: HTMLElement,
		private hooks: LayoutHooks,
	) {
		super();
		this.observer = new ResizeObserver((entries) => {
			// The content grew or shrank (sections arrived, notes rendered): check
			// which notes need shortening. The pane changed width: lay out again.
			if (entries.some((e) => e.target !== this.scroller)) this.schedulePass();
			if (this.scroller.clientWidth === this.width) return;
			this.width = this.scroller.clientWidth;
			this.layout();
		});
	}

	onload() {
		this.container.addClass('mg-reading');
		this.observer.observe(this.scroller);
		const sizer = this.scroller.querySelector('.markdown-preview-sizer');
		if (sizer) this.observer.observe(sizer);
		// Sections scrolled back into view are put back without being processed again.
		this.registerDomEvent(this.scroller, 'scroll', () => highlights.schedule(), { passive: true });
		this.registerDomEvent(this.container, 'mousemove', (e) => this.pointerMoved(e));
		this.registerDomEvent(this.container, 'mouseleave', () => this.setHover(null));
		this.registerDomEvent(this.container, 'click', (e) => this.clicked(e), true);
		this.layout();
	}

	onunload() {
		const win = this.container.win;
		win.cancelAnimationFrame(this.frames.pass);
		win.cancelAnimationFrame(this.frames.hover);
		this.observer.disconnect();
		highlights.setHover(this.scroller, null);
		this.container.removeClass(...MODES, 'mg-style-underline', 'mg-style-highlight', 'mg-style-none');
	}

	/** A margin beside the text (making room if needed), or popovers in narrow panes. */
	layout() {
		const { marginWidth, passageStyle } = this.hooks.settings();
		const need = marginWidth + GAP + EDGE;
		const c = this.container;
		c.setCssProps({ '--mg-width': `${marginWidth}px`, '--mg-gap': `${GAP}px`, '--mg-reserve': `${need}px` });
		for (const s of ['underline', 'highlight', 'none']) c.toggleClass(`mg-style-${s}`, s === passageStyle);
		if (this.scroller.clientWidth === 0) return;
		c.removeClass('mg-r-reserve');
		const right = this.scroller.getBoundingClientRect().left + this.scroller.clientWidth;
		const margin = right - this.textRight() >= need;
		const reserve = !margin && this.scroller.clientWidth - need >= MIN_TEXT;
		c.toggleClass('mg-r-margin', margin || reserve);
		c.toggleClass('mg-r-narrow', !margin && !reserve);
		c.toggleClass('mg-r-reserve', reserve);
		this.schedulePass();
	}

	private textRight(): number {
		const sizer = this.scroller.querySelector('.markdown-preview-sizer');
		const blocks = sizer?.querySelectorAll(':scope > div > p, :scope > div > :is(h1, h2, h3, ul, ol), .inline-title') ?? [];
		for (const el of Array.from(blocks)) {
			const r = el.getBoundingClientRect();
			if (r.width > 100) return r.right;
		}
		return (sizer ?? this.scroller).getBoundingClientRect().right;
	}

	/** Notes were added or the layout changed: check which need shortening. */
	schedulePass() {
		const win = this.container.win;
		win.cancelAnimationFrame(this.frames.pass);
		this.frames.pass = win.requestAnimationFrame(() => this.shorten());
	}

	/**
	 * A note shortens to one line when its full text would push the next note
	 * away from that note's passage. Floats stack by themselves, so this is
	 * one pass from the top that measures as it goes.
	 */
	private shorten() {
		const sides = Array.from(this.container.querySelectorAll<HTMLElement>('.mg-side'));
		for (const s of sides) {
			s.removeClass('is-collapsed');
			s.setCssProps({ '--mg-drop': '0px' });
		}
		if (!this.container.hasClass('mg-r-margin')) return;
		sides.forEach((side, i) => {
			align(side);
			const prev = sides[i - 1];
			const passage = passageTop(side);
			if (!prev || passage === null || prev.hasClass('is-pinned')) return;
			if (side.getBoundingClientRect().top - passage > DRIFT) {
				prev.addClass('is-collapsed');
				align(side);
			}
		});
	}

	// --- Pointer -------------------------------------------------------------

	private pointerMoved(e: MouseEvent) {
		const target = e.target;
		if (!(target instanceof Element) || target.closest('.mg-side')) return; // notes hover themselves
		const { clientX: x, clientY: y } = e;
		const win = this.container.win;
		win.cancelAnimationFrame(this.frames.hover);
		this.frames.hover = win.requestAnimationFrame(() => {
			const marker = target.closest<HTMLElement>('.mg-marker');
			if (marker) return this.setHover(marker.dataset.mgLabel ?? null);
			this.setHover(highlights.atPoint(this.scroller, x, y));
		});
	}

	setHover(label: string | null) {
		if (label === this.hovered) return;
		this.hovered = label;
		highlights.setHover(this.scroller, label);
		this.container.querySelectorAll<HTMLElement>('.mg-side, .mg-marker').forEach((el) => {
			el.toggleClass('is-hover', label !== null && el.dataset.mgLabel === label);
		});
	}

	private sideFor(label: string) {
		return this.container.querySelector<HTMLElement>(`.mg-side[data-mg-label="${CSS.escape(label)}"]`);
	}

	/**
	 * A number: opens its note as a popover under the passage (narrow panes),
	 * or shows a shortened note in full. A click elsewhere closes the popover.
	 */
	private clicked(e: MouseEvent) {
		const label = markerLabel(e);
		const side = label && this.sideFor(label);
		const target = e.target instanceof Element ? e.target : null;
		if (!side || !target) {
			if (!target?.closest('.mg-side')) this.closePopovers();
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		if (this.container.hasClass('mg-r-narrow')) {
			const open = !side.hasClass('is-open');
			this.closePopovers();
			const section = side.closest<HTMLElement>('.markdown-preview-sizer > div');
			const marker = target.closest<HTMLElement>('.mg-marker');
			if (!open || !section || !marker) return;
			const y = lineBottom(marker) - section.getBoundingClientRect().top + BELOW;
			side.setCssProps({ '--mg-pop-y': `${y}px` });
			side.addClass('is-open');
			this.setHover(label); // light up its passage, as the editor does
		} else if (side.hasClass('is-collapsed') || side.hasClass('is-pinned')) {
			side.toggleClass('is-pinned', !side.hasClass('is-pinned'));
			this.shorten();
		}
	}

	private closePopovers() {
		const open = this.container.querySelectorAll('.mg-side.is-open');
		open.forEach((el) => el.removeClass('is-open'));
		if (open.length) this.setHover(null);
	}
}

const markerLabel = (e: Event) =>
	(e.target instanceof Element ? e.target.closest<HTMLElement>('.mg-marker') : null)?.dataset.mgLabel;

/** The bottom of the line a number sits on (the number itself is raised). */
function lineBottom(marker: HTMLElement): number {
	const prev = marker.previousSibling;
	if (prev?.instanceOf(Text) && prev.length) {
		const r = marker.doc.createRange();
		r.setStart(prev, prev.length - 1);
		r.setEnd(prev, prev.length);
		const rect = r.getClientRects()[0];
		if (rect) return rect.bottom;
	}
	return marker.getBoundingClientRect().bottom;
}

/** A note placed before a callout or table drops down level with its passage. */
function align(side: HTMLElement) {
	if (!liftedTo.has(side)) return;
	side.setCssProps({ '--mg-drop': '0px' });
	const passage = passageTop(side);
	if (passage === null) return;
	const drop = Math.max(0, passage - side.getBoundingClientRect().top);
	side.setCssProps({ '--mg-drop': `${drop}px` });
}

/** Where a note's passage starts on screen (the note is inserted just before it). */
function passageTop(side: HTMLElement): number | null {
	const lifted = liftedTo.get(side);
	if (lifted) return lifted.startContainer.isConnected ? (lifted.getClientRects()[0]?.top ?? null) : null;
	const next = side.nextSibling;
	if (next?.instanceOf(Text) && next.length) {
		const r = side.doc.createRange();
		r.setStart(next, 0);
		r.setEnd(next, 1);
		return r.getClientRects()[0]?.top ?? null;
	}
	return next?.instanceOf(Element) ? next.getBoundingClientRect().top : null;
}
