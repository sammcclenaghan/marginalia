/**
 * Passages inside Live Preview widgets (tables, callouts, formulas, HTML)
 * can't carry CodeMirror marks, so their words are found in the rendered
 * widget and painted with highlights, as in Reading view.
 */
import { EditorView } from '@codemirror/view';
import { Model, norm, occurrences, project, Range as Span } from '../format';
import { highlights } from '../render/highlights';
import { findText, indexText, textRange } from '../render/text';

/** Elements Live Preview renders in place of their source. */
export const WIDGET = '.cm-embed-block, .cm-table-widget, .cm-callout, .cm-html-embed, .math, .cm-math';

/** Words to look for in a widget: the k-th occurrence of q. */
type Recipe = { q: string; k: number } | null;

export class WidgetPassages {
	private owners = new Set<Element>();
	/** Recipes for the current document, by note, part of the passage and widget. */
	private cache = new Map<string, Recipe>();
	private cacheDoc: unknown = null;
	/** Where passages that start inside a widget are on the page, to line up their cards. */
	readonly starts = new Map<string, Range>();

	constructor(private view: EditorView) {}

	/** Repaint; returns true if the passages starting in widgets moved (cards need placing again). */
	paint(model: Model): boolean {
		const view = this.view;
		const state = view.state;
		for (const o of this.owners) highlights.clear(o);
		this.owners.clear();
		const before = [...this.starts.keys()].join();
		this.starts.clear();
		if (this.cacheDoc !== state.doc) {
			this.cache.clear();
			this.cacheDoc = state.doc;
		}

		const widgets = Array.from(view.contentDOM.querySelectorAll(WIDGET)).filter(
			(w) => !w.parentElement?.closest(WIDGET), // outermost only
		);
		let doc: string | null = null;
		for (const w of widgets) {
			const range = this.sourceOf(w);
			if (!range) continue;
			for (const n of model.notes) {
				const a = n.anchor;
				if (!a) continue;
				const from = Math.max(a.from, range.from);
				const to = Math.min(a.to, range.to);
				if (from >= to) continue;
				const key = `${n.label}:${from}:${to}:${range.from}:${range.to}`;
				let recipe = this.cache.get(key);
				if (recipe === undefined) {
					doc ??= state.doc.toString();
					const q = norm(project(doc, from, to).text);
					const inWidget = project(doc, range.from, range.to).text;
					const preceding = norm(project(doc, range.from, from).text).length;
					recipe = q ? { q, k: occurrences(inWidget, q).filter((o) => o < preceding).length } : null;
					this.cache.set(key, recipe);
				}
				if (!recipe) continue;
				const idx = indexText(w);
				const found = findText(idx, recipe.q, recipe.k);
				const painted = found && textRange(idx, found.start, found.end);
				if (!painted) continue;
				highlights.add(w, n.label, recipe.q, recipe.k, n.question);
				this.owners.add(w);
				if (from === a.from) this.starts.set(n.label, painted);
			}
		}
		highlights.schedule();
		return [...this.starts.keys()].join() !== before;
	}

	/** The source a widget was rendered from. */
	private sourceOf(w: Element): Span | null {
		const view = this.view;
		try {
			const at = view.posAtDOM(w);
			if (!w.closest('.cm-line')) {
				const block = view.lineBlockAt(at);
				return { from: block.from, to: block.to };
			}
			// Inline: a formula or an HTML element.
			const rest = view.state.doc.sliceString(at, view.state.doc.lineAt(at).to);
			const m = /^(?:\$\$[^\n]*?\$\$|\$[^$\n]+?\$|<(\w+)[^>]*>[\s\S]*?<\/\1>)/.exec(rest);
			return m ? { from: at, to: at + m[0].length } : null;
		} catch {
			return null; // not in the document any more
		}
	}

	destroy() {
		for (const o of this.owners) highlights.clear(o);
		this.owners.clear();
		highlights.schedule();
	}
}
