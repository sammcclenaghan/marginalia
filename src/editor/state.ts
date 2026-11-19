/**
 * What an editor knows about its notes: the parsed notes section with each
 * note's passage, the selected note, and the plugin's settings.
 */
import { EditorState, Facet, StateEffect, StateField } from '@codemirror/state';
import { editorLivePreviewField } from 'obsidian';
import { buildModel, Model, noteAt, Range } from '../format';
import { DEFAULT_SETTINGS, MarginaliaSettings } from '../settings';

/** The plugin's settings, provided to every editor (see MarginaliaPlugin.applySettings). */
export const settingsFacet = Facet.define<MarginaliaSettings, MarginaliaSettings>({
	combine: (values) => values[0] ?? DEFAULT_SETTINGS,
});

/**
 * Notes for the current document. Passages are tracked through edits by
 * mapping their ranges; the quotes are only searched for again when the notes
 * section itself changes, so typing stays cheap.
 */
export const notesField = StateField.define<Model>({
	create: (s) => buildModel(s.doc.toString()),
	update(model, tr) {
		if (!tr.docChanged) return model;
		const doc = tr.state.doc.toString();
		const hints = new Map<string, Range | null>();
		const stale = new Set<string>();
		for (const n of model.notes) {
			if (n.stale) stale.add(n.label);
			const a = n.anchor;
			if (!a) continue;
			const from = tr.changes.mapPos(a.from, 1);
			const to = tr.changes.mapPos(a.to, -1);
			hints.set(n.label, to > from ? { from, to } : null);
			tr.changes.iterChangedRanges((fa, ta) => {
				if (fa < a.to && ta > a.from) stale.add(n.label);
			});
		}
		const next = buildModel(doc, { hints, trust: true, stale });
		// The notes themselves changed (a quote was rewritten, or the file was
		// edited elsewhere): search properly, with the old positions as hints.
		const quotesChanged =
			next.notes.length !== model.notes.length ||
			next.notes.some((n) => {
				const old = model.byLabel.get(n.label);
				return !old || old.entry.prefix !== n.entry.prefix || old.entry.suffix !== n.entry.suffix;
			});
		return quotesChanged ? buildModel(doc, { hints }) : next;
	},
});

/** Select a note (card or marker click). Cleared by the next cursor move. */
export const setActive = StateEffect.define<string | null>();
/** Open a note for editing. */
export const editNote = StateEffect.define<string>();

/**
 * A note being written that isn't in the document yet. Nothing is written
 * until it's saved, so cancelling leaves no trace and saving is one undo step.
 */
export interface Draft extends Range {
	/** The number it will get. */
	index: number;
}
export const DRAFT = 'draft';
export const startDraft = StateEffect.define<Draft>();
export const endDraft = StateEffect.define<null>();

export const draftField = StateField.define<Draft | null>({
	create: () => null,
	update(v, tr) {
		for (const e of tr.effects) {
			if (e.is(startDraft)) return e.value;
			if (e.is(endDraft)) return null;
		}
		if (!v || !tr.docChanged) return v;
		const from = tr.changes.mapPos(v.from, 1);
		const to = tr.changes.mapPos(v.to, -1);
		return from < to ? { ...v, from, to } : null;
	},
});

export const activeField = StateField.define<string | null>({
	create: () => null,
	update(v, tr) {
		for (const e of tr.effects) {
			if (e.is(setActive) || e.is(editNote)) return e.value;
			if (e.is(startDraft)) return DRAFT;
		}
		return tr.selection ? null : v;
	},
});

/** The note under the pointer, in the text or the margin. Only changes colours, never layout. */
export const setHover = StateEffect.define<string | null>();

export const hoverField = StateField.define<string | null>({
	create: () => null,
	update(v, tr) {
		for (const e of tr.effects) if (e.is(setHover)) return e.value;
		return v;
	},
});

/** The selected note, or else the note whose passage the cursor is in. */
export function activeLabel(state: EditorState): string | null {
	const explicit = state.field(activeField, false);
	if (explicit) return explicit;
	const model = state.field(notesField, false);
	return model ? (noteAt(model, state.selection.main.head)?.label ?? null) : null;
}

export function isLivePreview(state: EditorState): boolean {
	return state.field(editorLivePreviewField, false) ?? false;
}
