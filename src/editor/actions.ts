/** What you can do to notes in an editor. Every change is one undoable step. */
import { EditorView } from '@codemirror/view';
import { MarkdownFileInfo, Notice } from 'obsidian';
import { addEntry, Note, noteAt, norm, project, removeEntry, setBody, setQuote, snapToWords } from '../format';
import { draftField, editNote, endDraft, notesField, setActive, startDraft } from './state';

/** Each editor's view, by the file info Obsidian hands to commands and menus. */
const views = new WeakMap<MarkdownFileInfo, EditorView>();

export function trackView(view: EditorView, info: MarkdownFileInfo | null) {
	if (info) views.set(info, view);
}

export function viewFor(info: MarkdownFileInfo): EditorView | null {
	return views.get(info) ?? null;
}

export function noteAtCursor(view: EditorView): Note | null {
	return noteAt(view.state.field(notesField), view.state.selection.main.head);
}

/**
 * Start a note on the selection (or the word at the cursor). On a passage
 * that already has a note, open that note instead.
 */
export function addNote(view: EditorView) {
	const state = view.state;
	const model = state.field(notesField);
	const sel = state.selection.main;
	if (sel.empty) {
		const n = noteAt(model, sel.head);
		if (n) return view.dispatch({ effects: editNote.of(n.label) });
	}
	const doc = state.doc.toString();
	const range = snapToWords(doc, sel.from, Math.min(sel.to, model.bodyEnd));
	if (range.from >= model.bodyEnd || !/[\p{L}\p{N}]/u.test(doc.slice(range.from, range.to))) {
		new Notice('Select the passage you want to write about.');
		return;
	}
	// Already annotated: the same span, or the same words overlapping it.
	const words = norm(project(doc, range.from, range.to).text);
	const same = model.notes.find(
		(n) =>
			n.anchor &&
			((n.anchor.from === range.from && n.anchor.to === range.to) ||
				(norm(n.passage) === words && n.anchor.from < range.to && n.anchor.to > range.from)),
	);
	if (same) return view.dispatch({ effects: editNote.of(same.label) });
	const index = model.notes.filter((n) => n.anchor && n.anchor.from < range.from).length + 1;
	view.dispatch({ selection: { anchor: range.to }, effects: startDraft.of({ ...range, index }) });
}

/** Save a note's text; an emptied note is deleted (undo brings it back). */
export function saveNote(view: EditorView, label: string, text: string) {
	const note = view.state.field(notesField).byLabel.get(label);
	if (!note) return;
	if (text.trim() === '') return deleteNote(view, label);
	if (text.trim() !== note.text) view.dispatch({ changes: setBody(note, text), userEvent: 'input.marginalia' });
}

/** Write the note being drafted into the notes section, or drop it if it's empty. */
export function saveDraft(view: EditorView, text: string) {
	const state = view.state;
	const draft = state.field(draftField);
	if (!draft || text.trim() === '') return view.dispatch({ effects: endDraft.of(null) });
	const changes = addEntry(state.doc.toString(), state.field(notesField), draft, text);
	if (changes) return view.dispatch({ changes, effects: endDraft.of(null), userEvent: 'input.marginalia' });
	view.dispatch({ effects: endDraft.of(null) });
	new Notice("Couldn't attach a note there. Select some text in the note itself.");
}

export function deleteNote(view: EditorView, label: string) {
	const state = view.state;
	const model = state.field(notesField);
	const note = model.byLabel.get(label);
	if (note) view.dispatch({ changes: removeEntry(state.doc.toString(), model, note), userEvent: 'delete.marginalia' });
}

/** Move the cursor to the next or previous passage (wrapping around). */
export function jumpToNote(view: EditorView, dir: 1 | -1) {
	const model = view.state.field(notesField);
	const starts = model.notes.flatMap((n) => (n.anchor ? [n.anchor.from] : []));
	if (starts.length === 0) return;
	const head = view.state.selection.main.head;
	const from = noteAt(model, head)?.anchor?.from ?? head;
	const target =
		dir === 1
			? (starts.find((s) => s > from) ?? starts[0])
			: ([...starts].reverse().find((s) => s < from) ?? starts[starts.length - 1]);
	if (target === undefined) return;
	view.dispatch({ selection: { anchor: target }, effects: EditorView.scrollIntoView(target, { y: 'center' }) });
	view.focus();
}

/** Select a note: put the cursor at its passage, centred, and light it up. */
export function revealNote(view: EditorView, label: string) {
	const anchor = view.state.field(notesField).byLabel.get(label)?.anchor;
	if (!anchor) return;
	view.dispatch({
		selection: { anchor: anchor.from },
		effects: [EditorView.scrollIntoView(anchor.from, { y: 'center' }), setActive.of(label)],
	});
	view.focus();
}

/** Point a note at the selected passage (for a note whose passage was lost). */
export function reattachNote(view: EditorView, label: string) {
	const state = view.state;
	const model = state.field(notesField);
	const note = model.byLabel.get(label);
	const sel = state.selection.main;
	if (!note) return;
	if (sel.empty) {
		new Notice('Select the passage to attach the note to first.');
		return;
	}
	const doc = state.doc.toString();
	const changes = setQuote(doc, model, note, snapToWords(doc, sel.from, sel.to));
	if (!changes) new Notice('Select a passage in the note itself.');
	else view.dispatch({ changes, userEvent: 'input.marginalia' });
}
