/**
 * Finding each note's passage in the article from its quote. Passages can span
 * paragraphs, overlap and nest; nothing is written into the article itself.
 */
import { norm, occurrences, project, Projection, sourceRange } from './project';
import { Entry, parseSection, Section } from './section';
import type { Range } from './types';

export interface Note {
	/** Stable key, from the quote and its position among identical quotes. */
	label: string;
	/** 1-based display number: the order of passages in the document. */
	index: number;
	/** The passage in the document, or null when its quote can't be found. */
	anchor: Range | null;
	/** The quote, for display. */
	passage: string;
	/** The note, in Markdown. */
	text: string;
	question: boolean;
	entry: Entry;
	/** Found, but the passage's text no longer matches the quote exactly. */
	stale: boolean;
}

export interface Model {
	section: Section | null;
	/** End of the article: the start of the notes section, or the end of the document. */
	bodyEnd: number;
	/** In passage order; notes whose passage can't be found come last. */
	notes: Note[];
	byLabel: Map<string, Note>;
}

export interface BuildOptions {
	/** Last known passage of each note (by label), e.g. mapped through an edit. */
	hints?: Map<string, Range | null>;
	/** Use the hints as they are, without searching (only the article changed). */
	trust?: boolean;
	/** Notes whose passage was edited, so their quote needs refreshing. */
	stale?: Set<string>;
}

export const isQuestion = (text: string): boolean => /\?\s*$/.test(text);

function hash(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(36);
}

/** How well the text around a candidate matches the stored prefix/suffix (0–4). */
export function contextScore(p: Projection, start: number, length: number, prefix?: string, suffix?: string): number {
	let score = 0;
	if (prefix) {
		const before = p.text.slice(Math.max(0, start - prefix.length - 1), start).trimEnd();
		if (before.endsWith(norm(prefix))) score += 2;
	}
	if (suffix) {
		const after = p.text.slice(start + length, start + length + suffix.length + 1).trimStart();
		if (after.startsWith(norm(suffix))) score += 2;
	}
	return score;
}

interface Candidate {
	start: number;
	length: number;
}

/**
 * Find a quote's passage. Preference: an exact match (best context, then
 * nearest the hint), then the hinted range if the passage was edited in
 * place, then a loose match on the quote's opening and closing words.
 */
export function anchorQuote(
	p: Projection,
	quote: string,
	opts: { prefix?: string; suffix?: string; hint?: Range | null } = {},
): { range: Range; exact: boolean } | null {
	const q = norm(quote);
	if (!q) return null;
	const best = (cands: Candidate[]): Range | null => {
		let pick: Range | null = null;
		let bestScore = -Infinity;
		for (const c of cands) {
			const r = sourceRange(p, c.start, c.length);
			let score = contextScore(p, c.start, c.length, opts.prefix, opts.suffix) * 1e7;
			if (opts.hint) score -= Math.abs(r.from - opts.hint.from);
			if (score > bestScore) {
				bestScore = score;
				pick = r;
			}
		}
		return pick;
	};

	const exact = best(occurrences(p.text, q).map((start) => ({ start, length: q.length })));
	if (exact) return { range: exact, exact: true };
	if (opts.hint && opts.hint.to > opts.hint.from) return { range: opts.hint, exact: false };

	// Loose: opening and closing words (shorter and shorter, in case the edit
	// was near an end), a plausible distance apart.
	for (const n of [24, 16, 10, 6]) {
		if (n * 2 > q.length) continue;
		const tails = occurrences(p.text, q.slice(-n));
		const loose: Candidate[] = [];
		for (const h of occurrences(p.text, q.slice(0, n))) {
			const min = Math.max(h + n, h + Math.floor(q.length * 0.5) - n);
			const max = h + Math.ceil(q.length * 1.5) + 40;
			const t = tails.find((x) => x >= min && x <= max);
			if (t !== undefined) loose.push({ start: h, length: t + n - h });
		}
		const range = best(loose);
		if (range) return { range, exact: false };
	}
	return null;
}

/** Parse the notes section and find every note's passage. */
export function buildModel(doc: string, opts: BuildOptions = {}): Model {
	const section = parseSection(doc);
	const bodyEnd = section ? section.from : doc.length;
	if (!section || section.entries.length === 0) return { section, bodyEnd, notes: [], byLabel: new Map() };

	let projection: Projection | null = null;
	const article = () => (projection ??= project(doc, 0, bodyEnd));
	const seen = new Map<string, number>();
	const notes = section.entries.map((entry): Note => {
		const base = hash(norm(entry.quote));
		const k = seen.get(base) ?? 0;
		seen.set(base, k + 1);
		const label = k ? `${base}-${k}` : base;
		const hint = opts.hints?.get(label);
		const found =
			opts.trust && hint && hint.to > hint.from && hint.to <= bodyEnd
				? { range: hint, exact: !opts.stale?.has(label) }
				: anchorQuote(article(), entry.quote, { prefix: entry.prefix, suffix: entry.suffix, hint });
		return {
			label,
			index: 0,
			anchor: found?.range ?? null,
			passage: entry.display,
			text: entry.body,
			question: isQuestion(entry.body),
			entry,
			stale: !!found && (!found.exact || !!opts.stale?.has(label)),
		};
	});

	notes.sort((a, b) => {
		if (!a.anchor || !b.anchor) return (a.anchor ? 0 : 1) - (b.anchor ? 0 : 1);
		return a.anchor.from - b.anchor.from || b.anchor.to - a.anchor.to;
	});
	notes.forEach((n, i) => (n.index = i + 1));
	return { section, bodyEnd, notes, byLabel: new Map(notes.map((n) => [n.label, n])) };
}

/** The innermost note whose passage contains `pos` (edges included). */
export function noteAt(model: Model, pos: number): Note | null {
	let best: Note | null = null;
	let bestSize = Infinity;
	for (const n of model.notes) {
		const a = n.anchor;
		if (!a || pos < a.from || pos > a.to || a.to - a.from >= bestSize) continue;
		best = n;
		bestSize = a.to - a.from;
	}
	return best;
}
