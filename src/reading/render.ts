/**
 * Reading view, one rendered section at a time: each passage is painted, a
 * number follows it, and its note floats into the margin level with where it
 * starts. The notes section at the end of the file is hidden.
 *
 * Read-only: notes are added and edited in the editor.
 */
import { App, MarkdownPostProcessorContext, MarkdownRenderChild } from 'obsidian';
import { followLink, renderNote } from '../card';
import { Model, Note, occurrences, project } from '../format';
import { highlights } from '../render/highlights';
import { findText, indexText, insertAt, textRange } from '../render/text';

/** Blocks that clip what floats out of them: a note for a passage inside goes just before the block. */
const CLIPS = '.callout, table, .table-wrapper, pre';

/** For notes placed before a clipping block: where their passage starts, to line up with it. */
export const liftedTo = new WeakMap<HTMLElement, Range>();

export interface SectionHooks {
	app: App;
	hover(el: HTMLElement, label: string | null): void;
	/** Sidenotes were added: lay the margin out again. */
	changed(): void;
}

/** Offset where (0-based) line `line` starts. */
export function lineOffset(text: string, line: number): number {
	let pos = 0;
	for (let i = 0; i < line; i++) {
		const nl = text.indexOf('\n', pos);
		if (nl === -1) return text.length;
		pos = nl + 1;
	}
	return pos;
}

function lineEndOffset(text: string, line: number): number {
	const nl = text.indexOf('\n', lineOffset(text, line));
	return nl === -1 ? text.length : nl;
}

/** This section's part of a passage: its words, and which occurrence of them in the section. */
interface Part {
	note: Note;
	q: string;
	k: number;
	starts: boolean;
	ends: boolean;
}

function partsIn(text: string, from: number, to: number, notes: Note[]): Part[] {
	const p = project(text, from, to);
	return notes.flatMap((note) => {
		const a = note.anchor;
		if (!a) return [];
		const first = p.src.findIndex((s) => s >= Math.max(a.from, from));
		let last = -1;
		for (let i = p.src.length - 1; i >= 0; i--) {
			if ((p.src[i] ?? 0) < Math.min(a.to, to)) {
				last = i;
				break;
			}
		}
		if (first === -1 || last < first) return [];
		const q = p.text.slice(first, last + 1).trim();
		if (!q) return [];
		const k = occurrences(p.text, q).filter((o) => o < first).length;
		return [{ note, q, k, starts: a.from >= from, ends: a.to <= to }];
	});
}

export async function renderSection(el: HTMLElement, ctx: MarkdownPostProcessorContext, text: string, model: Model, hooks: SectionHooks) {
	const info = ctx.getSectionInfo(el);
	const section = model.section;
	if (!info || !section) return;
	const from = lineOffset(text, info.lineStart);
	const to = lineEndOffset(text, info.lineEnd);
	if (from >= section.from) {
		// The notes section: the margin shows it. Obsidian renders the footnote
		// list as the last block, so it can land here too: keep that.
		if (!el.querySelector('section.footnotes')) el.addClass('mg-notes-section');
		return;
	}

	const notes = model.notes.filter((n) => n.anchor && n.anchor.from < to && n.anchor.to > from);
	const parts = partsIn(text, from, to, notes);
	if (parts.length === 0) return;

	const child = new MarkdownRenderChild(el);
	ctx.addChild(child);
	child.register(() => {
		highlights.clear(el);
		highlights.schedule();
	});

	// Numbers after passages, then notes where they start (both change the
	// page, so look the words up again each time).
	for (const p of parts.filter((x) => x.ends)) {
		const idx = indexText(el);
		const at = findText(idx, p.q, p.k);
		if (at) insertAt(idx, at.end - 1, marker(p.note), true);
	}
	const sides: { el: HTMLElement; note: Note }[] = [];
	for (const p of parts.filter((x) => x.starts)) {
		const idx = indexText(el);
		const at = findText(idx, p.q, p.k);
		if (!at) continue;
		const side = sidenote(p.note, ctx.sourcePath, child, hooks);
		const start = idx.map[at.start]?.node;
		const clip = outermost(start?.parentElement ?? null, el);
		if (clip) {
			const passage = textRange(idx, at.start, at.start + 1);
			if (passage) liftedTo.set(side, passage);
			clip.before(side);
			// Obsidian makes table sections scroll sideways (an inline style),
			// which would clip the note too. A very wide annotated table then
			// overflows instead of scrolling.
			if (el.hasClass('el-table')) el.style.removeProperty('overflow-x');
		} else {
			insertAt(idx, at.start, side);
		}
		sides.push({ el: side, note: p.note });
	}
	for (const p of parts) {
		highlights.add(el, p.note.label, p.q, p.k, p.note.question);
		underlineGaps(el, p);
	}
	highlights.schedule(); // the section is usually put on the page after this returns
	for (const s of sides) {
		const body = s.el.querySelector<HTMLElement>('.mg-side-body');
		if (body) await renderNote(hooks.app, s.note.text, body, ctx.sourcePath, child);
	}
	hooks.changed();
}

/**
 * The browser doesn't draw an underline on a text node that is only spaces
 * (code highlighting puts every space between tokens in its own node; **bold**
 * *italic* does it too). Wrap those in a passage, so the highlight painter can
 * have styles.css draw their underline, as it does for formulas.
 */
function underlineGaps(el: HTMLElement, p: Part) {
	const idx = indexText(el);
	const at = findText(idx, p.q, p.k);
	const range = at && textRange(idx, at.start, at.end);
	if (!range) return;
	const gaps: Text[] = [];
	const walker = el.doc.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (node.instanceOf(Text) && /^\s+$/.test(node.data) && range.intersectsNode(node) && !node.parentElement?.closest('.mg-space, .mg-side, .mg-marker')) {
			gaps.push(node);
		}
	}
	for (const node of gaps) {
		const gap = createSpan({ cls: 'mg-space' });
		node.replaceWith(gap);
		gap.append(node);
	}
}

/** The outermost clipping block around `node`, inside the section. */
function outermost(node: HTMLElement | null, section: HTMLElement): HTMLElement | null {
	let found: HTMLElement | null = null;
	for (let el = node?.closest<HTMLElement>(CLIPS); el && section.contains(el) && el !== section; ) {
		found = el;
		el = el.parentElement?.closest<HTMLElement>(CLIPS) ?? null;
	}
	return found;
}

function marker(note: Note): HTMLElement {
	// Spaced with text, not padding, so an underline around it runs through.
	const el = createEl('sup', { cls: 'mg-marker', text: `\u2009${note.index}\u200A` });
	el.dataset.mgLabel = note.label;
	el.toggleClass('is-question', note.question);
	el.setAttr('aria-label', note.question ? 'Question' : 'Note');
	return el;
}

function sidenote(note: Note, path: string, child: MarkdownRenderChild, hooks: SectionHooks): HTMLElement {
	const el = createSpan({ cls: 'mg-side' });
	el.dataset.mgLabel = note.label;
	el.toggleClass('is-question', note.question);
	el.createSpan({ cls: 'mg-note-num', text: String(note.index) });
	el.createSpan({ cls: 'mg-side-body markdown-rendered' });
	child.registerDomEvent(el, 'click', (e) => followLink(hooks.app, e, path));
	child.registerDomEvent(el, 'mouseenter', () => hooks.hover(el, note.label));
	child.registerDomEvent(el, 'mouseleave', () => hooks.hover(el, null));
	return el;
}
