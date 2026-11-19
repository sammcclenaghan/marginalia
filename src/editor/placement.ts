/** Where notes go on the page: measured in CodeMirror's read phase, placed in its write phase. */
import { EditorView } from '@codemirror/view';
import type { NoteCard } from '../card';
import type { Range as Span } from '../format';
import { chooseCollapsed, layoutStack } from '../layout';
import { activeField, activeLabel, settingsFacet } from './state';

const GAP = 32; // between the text and the notes
const EDGE = 20; // between the notes and the pane edge
const MIN_TEXT = 420; // narrowest the text gets to make room for the margin
const PAD = 10; // card padding (styles.css: --mg-pad-x)
const POPOVER = 380; // widest a popover gets
const BELOW = 12; // between a passage's last line and its popover (clears the underline)

export type Mode = 'none' | 'margin' | 'narrow';

/** A note (or the draft) and its passage. */
export interface Item extends Span {
	label: string;
}

export interface Measured {
	textLeft: number;
	textRight: number;
	clientWidth: number;
	/** Where each passage starts and ends on the page (scroller coordinates). */
	tops: Map<string, number>;
	bottoms: Map<string, number>;
	/** Each card's full and one-line heights. */
	heights: Map<string, { full: number; short: number }>;
}

function textBox(view: EditorView): DOMRect {
	const line = view.contentDOM.querySelector(':scope > .cm-line');
	return (line ?? view.contentDOM).getBoundingClientRect();
}

/**
 * A margin beside the text, making room for it if needed, or popovers when
 * the pane is too narrow. Reads layout: call it outside CodeMirror's update.
 */
export function chooseMode(view: EditorView, hasNotes: boolean): Mode {
	const scroller = view.scrollDOM;
	const need = view.state.facet(settingsFacet).marginWidth + GAP + EDGE;
	scroller.setCssProps({ '--mg-reserve': `${need}px` });
	let mode: Mode = 'none';
	let reserve = false;
	if (hasNotes) {
		scroller.removeClass('mg-reserve');
		const right = scroller.getBoundingClientRect().left + scroller.clientWidth;
		if (right - textBox(view).right >= need) mode = 'margin';
		else if (scroller.clientWidth - need >= MIN_TEXT) [mode, reserve] = ['margin', true];
		else mode = 'narrow';
	}
	scroller.toggleClass('mg-reserve', reserve);
	return mode;
}

/** `painted`: where passages that start inside a widget are drawn. */
export function measure(view: EditorView, items: Item[], cards: Map<string, NoteCard>, painted: Map<string, Range>): Measured {
	const scroller = view.scrollDOM;
	const box = scroller.getBoundingClientRect();
	const toY = (y: number) => y - box.top + scroller.scrollTop;
	const visible = (pos: number) => pos >= view.viewport.from && pos <= view.viewport.to;
	const tops = new Map<string, number>();
	const bottoms = new Map<string, number>();
	for (const item of items) {
		// Line the card's first line up with the passage's first line. A passage
		// starting inside a widget lines up with its words, not the widget.
		const words = painted.get(item.label);
		const rect = words?.startContainer.isConnected ? words.getClientRects()[0] : null;
		const start = rect ?? (visible(item.from) ? view.coordsAtPos(item.from, 1) : null);
		const end = visible(item.to) ? view.coordsAtPos(item.to, -1) : null;
		const top = start
			? toY(start.top) + (start.bottom - start.top - 20) / 2 - 5
			: toY(view.documentTop) + view.lineBlockAt(item.from).top;
		tops.set(item.label, top);
		bottoms.set(item.label, end ? toY(end.bottom) : toY(view.documentTop) + view.lineBlockAt(item.to).bottom);
	}
	// Full and one-line heights, whatever each card shows right now.
	const heights = new Map<string, { full: number; short: number }>();
	let lineHeight = 0;
	for (const [label, card] of cards) {
		lineHeight ||= parseFloat(getComputedStyle(card.body).lineHeight) || 20;
		const chrome = card.el.offsetHeight - card.body.offsetHeight;
		const content = card.body.scrollHeight;
		heights.set(label, { full: chrome + content, short: chrome + Math.min(content, lineHeight) });
	}
	const text = textBox(view);
	return { textLeft: text.left - box.left, textRight: text.right - box.left, clientWidth: scroller.clientWidth, tops, bottoms, heights };
}

/**
 * The margin column: each note beside its passage, crowded ones shortened.
 * False if the margin no longer fits (the text moved without the pane
 * resizing, e.g. after zooming): the mode needs choosing again.
 */
export function placeColumn(view: EditorView, m: Measured, items: Item[], cards: Map<string, NoteCard>): boolean {
	const state = view.state;
	const left = m.textRight + GAP - PAD; // the note's text starts GAP from the article's
	const room = m.clientWidth - left - EDGE;
	const width = Math.max(160, Math.min(state.facet(settingsFacet).marginWidth, room));
	const order = items.filter((i) => cards.has(i.label));
	// Only a note being edited or selected pulls the column around; passing
	// the cursor through a passage just lights up its note.
	const explicit = state.field(activeField);
	const pinned = order.findIndex((i) => cards.get(i.label)?.editing || i.label === explicit);
	const ys = order.map((i) => m.tops.get(i.label) ?? 0);
	const full = order.map((i) => m.heights.get(i.label)?.full ?? 0);
	const short = order.map((i) => m.heights.get(i.label)?.short ?? 0);
	const collapsed = chooseCollapsed(ys, full, short, pinned);
	const tops = layoutStack(ys, order.map((_, i) => (collapsed[i] ? short[i] : full[i]) ?? 0), pinned);
	const active = activeLabel(state);
	order.forEach((item, i) => {
		const card = cards.get(item.label);
		if (!card) return;
		card.el.removeClass('is-open');
		card.setCollapsed(collapsed[i] ?? false);
		card.el.toggleClass('is-active', item.label === active);
		card.el.setCssProps({ '--mg-x': `${left}px`, '--mg-y': `${tops[i] ?? 0}px`, '--mg-w': `${width}px` });
		card.reveal();
	});
	return room >= state.facet(settingsFacet).marginWidth - PAD;
}

/** Narrow panes: the open note sits under the last line of its passage. */
export function placePopover(m: Measured, cards: Map<string, NoteCard>, open: string | null) {
	const width = Math.min(POPOVER, m.textRight - m.textLeft);
	for (const [label, card] of cards) {
		const isOpen = label === open;
		card.el.toggleClass('is-open', isOpen);
		card.el.toggleClass('is-active', isOpen);
		card.setCollapsed(false);
		if (!isOpen) continue;
		const y = (m.bottoms.get(label) ?? 0) + BELOW;
		card.el.setCssProps({ '--mg-x': `${m.textLeft}px`, '--mg-y': `${y}px`, '--mg-w': `${width}px` });
		card.reveal();
	}
}
