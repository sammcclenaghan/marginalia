/**
 * Adding, changing and removing notes. Every function returns text changes
 * (never mutates), so the editor can apply them as one undoable transaction.
 */
import { contextScore, Model, Note } from './anchor';
import { MATH, norm, occurrences, project, sourceRange } from './project';
import { FORMULA_END, FORMULA_START, formatBody, formatQuote, HEADING, MARKER } from './section';
import type { Change, Range } from './types';

const WORD = /[\p{L}\p{N}_'’]/u;

/** Extend [from, to) to whole words and trim whitespace; an empty range becomes the word around it. */
export function snapToWords(doc: string, from: number, to: number): Range {
	const at = (i: number) => doc.charAt(i);
	while (from < to && /\s/.test(at(from))) from++;
	while (to > from && /\s/.test(at(to - 1))) to--;
	if (from === to) {
		while (from > 0 && WORD.test(at(from - 1))) from--;
		while (to < doc.length && WORD.test(at(to))) to++;
	} else {
		while (from > 0 && WORD.test(at(from - 1)) && WORD.test(at(from))) from--;
		while (to < doc.length && WORD.test(at(to)) && WORD.test(at(to - 1))) to++;
	}
	return { from, to };
}

function trimWords(s: string, side: 'start' | 'end'): string {
	const t = s.trim();
	return (side === 'start' ? t.replace(/^\S*\s/, '') : t.replace(/\s\S*$/, '')).trim() || t;
}

export interface Quote {
	quote: string;
	prefix?: string;
	suffix?: string;
}

/**
 * The quote for the passage doc[range], plus the surrounding words when the
 * same words occur elsewhere in the article. Null if there's no text to quote.
 */
export function quoteFor(doc: string, model: Model, range: Range): Quote | null {
	if (range.from >= model.bodyEnd) return null;
	const qp = project(doc, range.from, Math.min(range.to, model.bodyEnd), true);
	if (!/[\p{L}\p{N}]/u.test(qp.text.replaceAll(MATH, 'x'))) return null;
	// Formulas are written as their source, so the quote stays readable.
	let quote = '';
	for (let i = 0; i < qp.text.length; i++) {
		const end = qp.ends.get(i);
		const src = qp.src[i] ?? 0;
		quote += end === undefined ? qp.text.charAt(i) : FORMULA_START + norm(doc.slice(src, end)) + FORMULA_END;
	}
	quote = quote.trim();

	const p = project(doc, 0, model.bodyEnd);
	const q = norm(qp.text);
	const all = occurrences(p.text, q);
	if (all.length <= 1) return { quote };
	// Ours is the first occurrence reaching into the selection (a selection
	// inside a formula starts after the formula does).
	const mine = all.find((s) => sourceRange(p, s, q.length).to > range.from) ?? all[0] ?? 0;
	for (const n of [16, 32, 64, 128]) {
		const prefix = trimWords(p.text.slice(Math.max(0, mine - n), mine), 'start');
		const suffix = trimWords(p.text.slice(mine + q.length, mine + q.length + n), 'end');
		const full = (prefix ? 2 : 0) + (suffix ? 2 : 0);
		if (all.filter((s) => contextScore(p, s, q.length, prefix, suffix) === full).length === 1) {
			return { quote, prefix: prefix || undefined, suffix: suffix || undefined };
		}
	}
	return { quote };
}

const entryText = (q: Quote, body: string): string => `${formatQuote(q.quote, q.prefix, q.suffix)}\n\n${formatBody(body)}`;

/** Add a note on the passage doc[range], keeping notes in passage order. */
export function addEntry(doc: string, model: Model, range: Range, body: string): Change[] | null {
	const q = quoteFor(doc, model, range);
	if (!q) return null;
	const text = entryText(q, body);
	const trimmedEnd = doc.trimEnd().length;
	const section = model.section;
	if (!section) {
		const sep = trimmedEnd ? '\n\n' : '';
		return [{ from: trimmedEnd, to: doc.length, insert: `${sep}${MARKER}\n---\n\n${HEADING}\n\n${text}\n` }];
	}
	const next = model.notes.find((n) => n.anchor && n.anchor.from > range.from);
	if (next) return [{ from: next.entry.from, to: next.entry.from, insert: `${text}\n\n` }];
	const last = section.entries[section.entries.length - 1];
	if (last) return [{ from: last.to, to: last.to, insert: `\n\n${text}` }];
	return [{ from: trimmedEnd, to: doc.length, insert: `\n\n${text}\n` }];
}

/** Replace a note's text. */
export function setBody(note: Note, body: string): Change[] {
	const e = note.entry;
	if (e.bodyFrom === e.bodyTo && e.bodyFrom === e.quoteTo) {
		return [{ from: e.quoteTo, to: e.quoteTo, insert: `\n\n${formatBody(body)}` }];
	}
	return [{ from: e.bodyFrom, to: e.bodyTo, insert: formatBody(body) }];
}

/** Point a note at a new passage (after its words were edited, or to re-attach it). */
export function setQuote(doc: string, model: Model, note: Note, range: Range): Change[] | null {
	const q = quoteFor(doc, model, range);
	if (!q) return null;
	return [{ from: note.entry.quoteFrom, to: note.entry.quoteTo, insert: formatQuote(q.quote, q.prefix, q.suffix) }];
}

/** Remove a note; removing the last one removes the whole section. */
export function removeEntry(doc: string, model: Model, note: Note): Change[] {
	const section = model.section;
	if (!section) return [];
	if (section.entries.length === 1) {
		return [{ from: section.from, to: doc.length, insert: section.from > 0 ? '\n' : '' }];
	}
	const e = note.entry;
	let { from, to } = e;
	if (section.entries[section.entries.length - 1] === e) {
		while (from > 0 && /\s/.test(doc.charAt(from - 1))) from--;
	} else {
		while (to < doc.length && /\s/.test(doc.charAt(to))) to++;
	}
	return [{ from, to, insert: '' }];
}

export function applyChanges(doc: string, changes: Change[]): string {
	let out = '';
	let pos = 0;
	for (const c of [...changes].sort((a, b) => a.from - b.from)) {
		out += doc.slice(pos, c.from) + c.insert;
		pos = c.to;
	}
	return out + doc.slice(pos);
}

/** Apply a transform to a file's text, preserving Windows line endings. */
export function withLf(data: string, fn: (doc: string) => string): string {
	const crlf = data.includes('\r\n');
	const out = fn(crlf ? data.replace(/\r\n/g, '\n') : data);
	return crlf ? out.replace(/\n/g, '\r\n') : out;
}
