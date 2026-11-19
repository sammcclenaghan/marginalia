/**
 * The text of rendered elements (Reading view sections, Live Preview widgets),
 * normalised the same way as the article's plain text, with every character
 * mapped back to where it is on the page.
 */
import { MATH, occurrences } from '../format';

/** Rendered elements whose text isn't part of the article's prose. */
const SKIP =
	'.mg-side, .mg-marker, .mg-margin, sup.footnote-ref, section.footnotes, .frontmatter, .frontmatter-container, ' +
	'.metadata-container, .internal-embed, .copy-code-button, .collapse-indicator, .callout-icon, .callout-fold, ' +
	'button, .mod-header, .table-col-drag-handle, .table-row-drag-handle, .edit-block-button, .cm-widgetBuffer, .code-block-flair';
/** A rendered formula: one placeholder character, as in the source. */
const MATH_EL = '.math, mjx-container';
const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th, dt, dd, div, figcaption, tr';

interface Point {
	node: Node;
	/** Character offset in a text node, or -1 for a whole element (a formula). */
	offset: number;
}

export interface TextIndex {
	text: string;
	map: Point[];
}

export function indexText(root: Node): TextIndex {
	let text = '';
	const map: Point[] = [];
	let space = false;
	let lastBlock: Element | null = null;

	const push = (c: string, p: Point) => {
		if (space && text.length) {
			text += ' ';
			map.push(p);
		}
		space = false;
		text += c;
		map.push(p);
	};

	const walk = (node: Node) => {
		if (node.instanceOf(Element)) {
			if (node.matches(SKIP)) return;
			const block = node.matches(BLOCK) ? node : null;
			if (block && block !== lastBlock) {
				space = true;
				lastBlock = block;
			}
			if (node.matches(MATH_EL)) {
				push(MATH, { node, offset: -1 });
				return;
			}
			for (let c = node.firstChild; c; c = c.nextSibling) walk(c);
			if (block) space = true;
			return;
		}
		if (!node.instanceOf(Text)) return;
		const data = node.data;
		for (let i = 0; i < data.length; i++) {
			const c = data.charAt(i);
			if (/\s/.test(c)) space = true;
			else push(c, { node, offset: i });
		}
	};
	walk(root);
	return { text, map };
}

/** The k-th occurrence of `q` (or the last one, if there are fewer). */
export function findText(idx: TextIndex, q: string, k: number): { start: number; end: number } | null {
	const all = occurrences(idx.text, q);
	const start = all[Math.min(k, all.length - 1)];
	return start === undefined ? null : { start, end: start + q.length };
}

/** A DOM range over indexed characters [start, end). */
export function textRange(idx: TextIndex, start: number, end: number): Range | null {
	const a = idx.map[start];
	const b = idx.map[end - 1];
	if (!a || !b) return null;
	const r = a.node.ownerDocument?.createRange();
	if (!r) return null;
	if (a.offset === -1) r.setStartBefore(a.node);
	else r.setStart(a.node, a.offset);
	if (b.offset === -1) r.setEndAfter(b.node);
	else r.setEnd(b.node, b.offset + 1);
	return r;
}

/** Insert `el` before the indexed character `at` (or after it). */
export function insertAt(idx: TextIndex, at: number, el: HTMLElement, after = false) {
	const point = idx.map[at];
	if (!point) return;
	const { node, offset } = point;
	if (offset === -1 || !node.instanceOf(Text)) {
		node.parentNode?.insertBefore(el, after ? node.nextSibling : node);
		return;
	}
	const split = after ? offset + 1 : offset;
	if (split >= node.length) node.parentNode?.insertBefore(el, node.nextSibling);
	else node.parentNode?.insertBefore(el, node.splitText(split));
}
