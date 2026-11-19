/**
 * The notes section at the end of a file:
 *
 *   <!-- marginalia -->
 *   ---
 *
 *   ## Notes
 *
 *   > the ability to focus without distraction
 *
 *   Why a skill and not a trait?
 *
 *   > produces better results <!-- prefix: "It", suffix: "in less time" -->
 *
 *   Compare with Newport's later work.
 *
 * Each entry is a quote of the passage (plain text; a passage spanning
 * paragraphs is quoted paragraph by paragraph), a blank line, then the note in
 * Markdown. The prefix/suffix comment only appears when the quoted words occur
 * more than once in the article (W3C Web Annotation's TextQuoteSelector).
 */
import { MATH, norm } from './project';

export const MARKER = '<!-- marginalia -->';
export const HEADING = '## Notes';

/** Wraps a formula's source inside quote text being written (it's written as-is). */
export const FORMULA_START = '\uE001';
export const FORMULA_END = '\uE002';

export interface Entry {
	/** The quote as matched against the article (formulas as placeholders). */
	quote: string;
	/** The quote for display (formulas as their source). */
	display: string;
	prefix?: string;
	suffix?: string;
	/** The note, in Markdown. */
	body: string;
	/** The whole entry, from its first quote line to the end of its body. */
	from: number;
	to: number;
	quoteFrom: number;
	quoteTo: number;
	bodyFrom: number;
	bodyTo: number;
}

export interface Section {
	/** Start of the section, including the blank lines before the marker. */
	from: number;
	marker: number;
	entries: Entry[];
}

interface Line {
	from: number;
	to: number;
	text: string;
}

const QUOTE_LINE = /^\s*>/;
const CONTEXT_COMMENT = /\s*<!--([\s\S]*?)-->\s*$/;
const UNESCAPE = /\\([!-/:-@[-`{-~])/g;

const unescape = (text: string): string => text.replace(UNESCAPE, '$1');

function escapePlain(text: string): string {
	return text.replace(/([\\`*_[\]<$])/g, '\\$1').replace(/(==|~~|%%)/g, '\\$1');
}

/** Escape plain text for a quote line, so it can't turn into Markdown syntax. */
function escapeQuote(text: string): string {
	return text
		.split(new RegExp(`${FORMULA_START}([\\s\\S]*?)${FORMULA_END}`))
		.map((part, i) => (i % 2 ? part : escapePlain(part)))
		.join('')
		.replace(/^([#+-])/, '\\$1')
		.replace(/^(\d+)([.)])/, '$1\\$2');
}

/** A formula in a quote: unescaped `$…$` or `$$…$$`. */
const FORMULA = /(?<!\\)\$\$[\s\S]*?(?<!\\)\$\$|(?<!\\)\$(?!\s)[^$\n]+?(?<!\\)\$/g;

/** Formulas become placeholders for matching. */
const toPlaceholders = (raw: string): string => raw.replace(FORMULA, MATH);

/** Unescape the text around formulas; a formula's backslashes are its own (`\,`, `\frac`). */
function unescapeText(raw: string): string {
	let out = '';
	let last = 0;
	for (const m of raw.matchAll(FORMULA)) {
		out += unescape(raw.slice(last, m.index)) + m[0];
		last = m.index + m[0].length;
	}
	return out + unescape(raw.slice(last));
}

const jsonString = (s: string): string => JSON.stringify(s).replace(new RegExp(MATH, 'g'), '\\ue000');

function formatContext(prefix?: string, suffix?: string): string {
	const parts: string[] = [];
	if (prefix) parts.push(`prefix: ${jsonString(prefix)}`);
	if (suffix) parts.push(`suffix: ${jsonString(suffix)}`);
	return parts.length ? ` <!-- ${parts.join(', ')} -->` : '';
}

function parseContext(comment: string): { prefix?: string; suffix?: string } {
	const out: { prefix?: string; suffix?: string } = {};
	for (const m of comment.matchAll(/(prefix|suffix):\s*("(?:[^"\\]|\\.)*")/g)) {
		try {
			const value: unknown = JSON.parse(m[2] ?? '""');
			if (typeof value === 'string') out[m[1] === 'prefix' ? 'prefix' : 'suffix'] = value;
		} catch {
			// Malformed context: ignore it, the quote alone still anchors.
		}
	}
	return out;
}

export function formatQuote(quote: string, prefix?: string, suffix?: string): string {
	const paragraphs = quote.split(/\n{2,}/).map((p) => '> ' + escapeQuote(norm(p)));
	return paragraphs.join('\n>\n') + formatContext(prefix, suffix);
}

export function formatBody(text: string): string {
	return text
		.replace(/\r\n?/g, '\n')
		.trim()
		.split('\n')
		.map((l) => (QUOTE_LINE.test(l) ? l.replace('>', '\\>') : l))
		.join('\n');
}

const unescapeBody = (text: string): string => text.replace(/^(\s*)\\>/gm, '$1>').trim();

function linesAfter(doc: string, pos: number): Line[] {
	const lines: Line[] = [];
	while (pos < doc.length) {
		const nl = doc.indexOf('\n', pos);
		const to = nl === -1 ? doc.length : nl;
		lines.push({ from: pos, to, text: doc.slice(pos, to) });
		if (nl === -1) break;
		pos = nl + 1;
	}
	return lines;
}

/** Find and read the notes section, or null if the file has none. */
export function parseSection(doc: string): Section | null {
	const at = doc.lastIndexOf('\n' + MARKER);
	const marker = at === -1 ? (doc.startsWith(MARKER) ? 0 : -1) : at + 1;
	if (marker === -1) return null;
	const markerEnd = doc.indexOf('\n', marker);
	if (doc.slice(marker, markerEnd === -1 ? doc.length : markerEnd).trim() !== MARKER) return null;
	let from = marker;
	while (from > 0 && /\s/.test(doc.charAt(from - 1))) from--;

	const lines = linesAfter(doc, markerEnd === -1 ? doc.length : markerEnd + 1);
	const text = (i: number) => lines[i]?.text ?? '';
	let i = 0;
	const skipBlank = () => {
		while (i < lines.length && text(i).trim() === '') i++;
	};
	// The separator and heading before the first entry.
	skipBlank();
	if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(text(i))) i++;
	skipBlank();
	if (/^#{1,6}\s/.test(text(i))) i++;

	const entries: Entry[] = [];
	for (skipBlank(); i < lines.length; skipBlank()) {
		const first = lines[i];
		if (!first) break;
		if (!QUOTE_LINE.test(first.text)) {
			// Stray text: it belongs to the previous note.
			const last = entries[entries.length - 1];
			if (last) {
				last.bodyTo = last.to = first.to;
				last.body = unescapeBody(doc.slice(last.bodyFrom, last.bodyTo));
			}
			i++;
			continue;
		}

		const quoteLines: string[] = [];
		let context: { prefix?: string; suffix?: string } = {};
		let quoteTo = first.to;
		for (let line = lines[i]; line && QUOTE_LINE.test(line.text); line = lines[++i]) {
			let t = line.text.replace(/^\s*>\s?/, '');
			const comment = CONTEXT_COMMENT.exec(t);
			if (comment) {
				context = parseContext(comment[1] ?? '');
				t = t.slice(0, comment.index);
			}
			quoteLines.push(t);
			quoteTo = line.to;
		}
		const paragraphs = quoteLines.join('\n').split(/\n\s*\n/).map(norm).filter(Boolean);

		skipBlank();
		let bodyFrom = lines[i]?.from ?? quoteTo;
		let bodyTo = bodyFrom;
		// The body runs until a quote line that follows a blank line (the next entry).
		for (; i < lines.length; i++) {
			if (QUOTE_LINE.test(text(i)) && text(i - 1).trim() === '') break;
			if (text(i).trim() !== '') bodyTo = lines[i]?.to ?? bodyTo;
		}
		if (bodyTo === bodyFrom) bodyFrom = bodyTo = quoteTo;

		entries.push({
			quote: paragraphs.map((p) => unescape(toPlaceholders(p))).join('\n\n'),
			display: paragraphs.map(unescapeText).join('\n\n'),
			...context,
			body: unescapeBody(doc.slice(bodyFrom, bodyTo)),
			from: first.from,
			to: Math.max(bodyTo, quoteTo),
			quoteFrom: first.from,
			quoteTo,
			bodyFrom,
			bodyTo,
		});
	}
	return { from, marker, entries };
}
