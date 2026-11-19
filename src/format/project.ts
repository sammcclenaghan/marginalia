/**
 * Plain text of Markdown, roughly as Obsidian renders it, with every character
 * mapped back to its offset in the source. Notes find their passage by
 * matching a quote against this text, so syntax in between (links, emphasis,
 * list markers…) never gets in the way.
 */

/**
 * A formula in projected text. Rendered math isn't text, so a formula counts
 * as one placeholder character on both sides (source and rendered page).
 */
export const MATH = '';

export interface Projection {
	/** Plain text: Markdown syntax removed, whitespace collapsed to single spaces. */
	text: string;
	/** `src[i]` is the source offset of `text[i]`. */
	src: number[];
	/** For placeholders (formulas): where the formula ends in the source. */
	ends: Map<number, number>;
}

/** Indentation, quote markers, callout headers, headings, list markers and checkboxes. */
export const LINE_PREFIX =
	/^(?:[ \t]{0,3}>[ \t]?)*(?:\[![^\]\n]*\][+-]?[ \t]*)?(?:[ \t]{0,3}#{1,6}[ \t]+|[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[.\][ \t]+)?)?/;

/** Syntax that contributes no text. */
const SKIP = [
	/<!--[\s\S]*?-->/y, // HTML comment
	/%%[\s\S]*?%%/y, // Obsidian comment
	/!\[\[[^\]\n]*\]\]/y, // embed
	/!\[[^\]\n]*\]\([^)\n]*\)/y, // image
	/\[\^[^\]\s]+\]/y, // footnote reference
	/\^\[[^\]\n]*\]/y, // inline footnote
	/<\/?[A-Za-z][^>\n]*>/y, // HTML tag (its text content is kept)
];
const INLINE_MATH = [/\$\$[^\n]*?\$\$/y, /\$(?!\s)[^$\n]+?(?<!\s)\$(?!\d)/y];
/** Links, with where their shown text starts within the match. */
const LINKS: [RegExp, (m: RegExpExecArray) => number][] = [
	[/\[\[[^\]|\n]*\|([^\]\n]*)\]\]/y, (m) => m[0].length - 2 - (m[1] ?? '').length], // [[target|alias]]
	[/\[\[([^\]\n]*)\]\]/y, () => 2], // [[target]]
	[/\[([^\]\n]*)\]\([^)\n]*\)/y, () => 1], // [text](url)
];
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const BLOCK_START = /^[ \t]*(?:#|[-*+][ \t]|\d{1,9}[.)][ \t]|>)/;
const ESCAPABLE = /[!-/:-@[-`{-~]/;
const WORD_CHAR = /[\p{L}\p{N}]/u;

export const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

export function occurrences(text: string, needle: string): number[] {
	const out: number[] = [];
	if (!needle) return out;
	for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) out.push(i);
	return out;
}

/** Builds the projected text, keeping only characters inside [from, to). */
class Builder {
	text = '';
	src: number[] = [];
	ends = new Map<number, number>();
	private space = true; // suppresses leading whitespace
	private paragraph = false;

	constructor(
		private readonly paragraphs: boolean,
		private readonly from: number,
		private readonly to: number,
	) {}

	char(c: string, at: number, force = false) {
		if (!force && (at < this.from || at >= this.to)) return;
		if (/\s/.test(c)) {
			this.space = true;
			return;
		}
		if (this.text.length > 0) {
			if (this.paragraph && this.paragraphs) {
				this.text += '\n\n';
				this.src.push(at, at);
			} else if (this.space) {
				this.text += ' ';
				this.src.push(at);
			}
		}
		this.space = false;
		this.paragraph = false;
		this.text += c;
		this.src.push(at);
	}

	/** A formula: one placeholder for source [at, end). Overlapping the range at all includes it. */
	formula(at: number, end: number) {
		if (end <= this.from || at >= this.to) return;
		this.char(MATH, at, true);
		this.ends.set(this.text.length - 1, end);
	}

	softBreak() {
		this.space = true;
	}

	paragraphBreak() {
		this.space = true;
		this.paragraph = true;
	}
}

/** A sticky regex match at `i` that ends by `to`. */
function matchAt(re: RegExp, doc: string, i: number, to: number): RegExpExecArray | null {
	re.lastIndex = i;
	const m = re.exec(doc);
	return m && i + m[0].length <= to ? m : null;
}

function emitInline(b: Builder, doc: string, from: number, to: number, table: boolean) {
	let i = from;
	outer: while (i < to) {
		const c = doc.charAt(i);
		if (c === '$') {
			for (const re of INLINE_MATH) {
				const m = matchAt(re, doc, i, to);
				if (m) {
					b.formula(i, i + m[0].length);
					i += m[0].length;
					continue outer;
				}
			}
		}
		if ('<%![^'.includes(c)) {
			for (const re of SKIP) {
				const m = matchAt(re, doc, i, to);
				if (m) {
					i += m[0].length;
					continue outer;
				}
			}
		}
		if (c === '[') {
			for (const [re, offset] of LINKS) {
				const m = matchAt(re, doc, i, to);
				if (m) {
					const inner = i + offset(m);
					emitInline(b, doc, inner, inner + (m[1] ?? '').length, table);
					i += m[0].length;
					continue outer;
				}
			}
		}
		const next = doc.charAt(i + 1);
		if (c === '\\' && i + 1 < to && ESCAPABLE.test(next)) {
			b.char(next, i + 1);
			i += 2;
		} else if (c === '|' && table) {
			b.softBreak(); // table cell divider
			i++;
		} else if (c === '*' || c === '`') {
			i++;
		} else if ((c === '=' || c === '~') && next === c) {
			i += 2;
		} else if (c === '_' && !(WORD_CHAR.test(doc.charAt(i - 1)) && WORD_CHAR.test(next))) {
			i++;
		} else {
			b.char(c, i);
			i++;
		}
	}
}

/** Where the article starts, after any frontmatter. */
function afterFrontmatter(doc: string): number {
	if (!doc.startsWith('---\n')) return 0;
	const close = doc.indexOf('\n---', 3);
	if (close === -1) return 0;
	const nl = doc.indexOf('\n', close + 4);
	return nl === -1 ? doc.length : nl + 1;
}

/**
 * Plain text of doc[from, to) with each character mapped back to its source
 * offset. Whole lines are always read so syntax that starts before `from` is
 * still recognised. With `paragraphs`, paragraph breaks are kept as "\n\n"
 * (for writing quotes); otherwise everything collapses to single spaces (for
 * matching).
 */
export function project(doc: string, from = 0, to = doc.length, paragraphs = false): Projection {
	const b = new Builder(paragraphs, from, to);
	let pos = afterFrontmatter(doc);
	let fence: string | null = null;
	let pendingParagraph = false;

	while (pos < to) {
		const nl = doc.indexOf('\n', pos);
		const lineEnd = nl === -1 ? doc.length : nl;
		const line = doc.slice(pos, lineEnd);
		const trimmed = line.trim();
		const fenceMark = FENCE.exec(line)?.[1];
		const inRange = lineEnd >= from;

		if (fence) {
			if (fenceMark && fenceMark[0] === fence[0] && fenceMark.length >= fence.length && trimmed === fenceMark) {
				fence = null;
				pendingParagraph = true;
			} else if (inRange) {
				for (let k = pos; k < lineEnd; k++) b.char(doc.charAt(k), k);
				b.softBreak();
			}
		} else if (fenceMark) {
			fence = fenceMark;
			pendingParagraph = true;
		} else if (trimmed.startsWith('$$') && !(trimmed.length > 4 && trimmed.endsWith('$$'))) {
			// A display formula: one placeholder for the whole block.
			const start = pos + line.indexOf('$$');
			const close = doc.indexOf('$$', start + 2);
			const end = close === -1 ? doc.length : close + 2;
			if (end > from && start < to) {
				b.paragraphBreak();
				b.formula(start, end);
			}
			pendingParagraph = true;
			const after = doc.indexOf('\n', end);
			if (after === -1) break;
			pos = after + 1;
			continue;
		} else if (TABLE_DELIMITER.test(line) && line.includes('-') && line.includes('|')) {
			pendingParagraph = true; // a table's | --- | row isn't text
		} else if (trimmed === '') {
			pendingParagraph = true;
		} else if (inRange) {
			const prefix = LINE_PREFIX.exec(line)?.[0].length ?? 0;
			// Headings, list items and quote lines are blocks of their own.
			if (pendingParagraph || BLOCK_START.test(line)) b.paragraphBreak();
			pendingParagraph = false;
			emitInline(b, doc, pos + prefix, lineEnd, /^\s*\|/.test(line));
			b.softBreak();
		}
		if (nl === -1) break;
		pos = nl + 1;
	}
	return { text: b.text, src: b.src, ends: b.ends };
}

/** Source range of projected text [start, start + length). */
export function sourceRange(p: Projection, start: number, length: number): { from: number; to: number } {
	const last = start + length - 1;
	return { from: p.src[start] ?? 0, to: p.ends.get(last) ?? (p.src[last] ?? 0) + 1 };
}
