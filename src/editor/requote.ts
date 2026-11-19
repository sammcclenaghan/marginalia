/**
 * When a passage's words are edited, its note's quote is rewritten to match
 * once typing pauses, so the note still finds its passage next time the file
 * opens (in Obsidian or after editing elsewhere). It follows your edit, so it
 * stays out of the undo history.
 */
import { Transaction } from '@codemirror/state';
import { EditorView, PluginValue, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { setQuote } from '../format';
import { notesField } from './state';

const DELAY = 700;

class Requote implements PluginValue {
	private timer = 0;

	constructor(private view: EditorView) {}

	update(u: ViewUpdate) {
		if (!u.docChanged) return;
		const model = u.state.field(notesField);
		if (!model.notes.some((n) => n.stale && n.anchor)) return;
		const win = this.view.dom.win;
		win.clearTimeout(this.timer);
		this.timer = win.setTimeout(() => this.requote(), DELAY);
	}

	private requote() {
		const state = this.view.state;
		const model = state.field(notesField);
		const doc = state.doc.toString();
		const changes = model.notes
			.flatMap((n) => (n.stale && n.anchor ? (setQuote(doc, model, n, n.anchor) ?? []) : []))
			.filter((c) => doc.slice(c.from, c.to) !== c.insert);
		if (changes.length === 0) return;
		this.view.dispatch({ changes, annotations: Transaction.addToHistory.of(false), userEvent: 'marginalia.requote' });
	}

	destroy() {
		this.view.dom.win.clearTimeout(this.timer);
	}
}

export const requotePlugin = ViewPlugin.fromClass(Requote);
