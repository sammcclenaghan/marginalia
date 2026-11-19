/**
 * What notes look like in the text: passages, a number after each one, and
 * the notes section hidden in Live Preview.
 */
import { EditorState, RangeSetBuilder, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { LINE_PREFIX } from '../format';
import {
	activeLabel,
	DRAFT,
	draftField,
	editNote,
	endDraft,
	hoverField,
	isLivePreview,
	notesField,
	setActive,
	setHover,
	settingsFacet,
	startDraft,
} from './state';

class MarkerWidget extends WidgetType {
	constructor(
		readonly label: string,
		readonly index: number,
		readonly question: boolean,
		readonly active: boolean,
		readonly hover: boolean,
	) {
		super();
	}

	eq(o: MarkerWidget) {
		return (
			o.label === this.label &&
			o.index === this.index &&
			o.question === this.question &&
			o.active === this.active &&
			o.hover === this.hover
		);
	}

	toDOM() {
		// Spaced with text (thin and hair spaces), not padding: a passage's
		// underline is only drawn under text, so it runs through the number.
		const el = createEl('sup', { cls: 'mg-marker', text: `\u2009${this.index}\u200A` });
		el.dataset.mgLabel = this.label;
		el.toggleClass('is-question', this.question);
		el.toggleClass('is-active', this.active);
		el.toggleClass('is-hover', this.hover);
		el.setAttr('aria-label', this.question ? 'Question' : 'Note');
		return el;
	}

	ignoreEvent() {
		return false; // the margin handles clicks on markers
	}
}

class HiddenSectionWidget extends WidgetType {
	eq() {
		return true;
	}

	toDOM() {
		return createDiv({ cls: 'mg-hidden-section' });
	}

	get estimatedHeight() {
		return 0;
	}
}

/**
 * The parts of [from, to) that are text, line by line: a passage spanning a
 * list, quote or headings shouldn't underline indentation, bullets, numbers,
 * checkboxes or `>` and `#` markers.
 */
export function textRanges(state: EditorState, from: number, to: number): { from: number; to: number }[] {
	const out: { from: number; to: number }[] = [];
	for (let pos = from; pos < to; ) {
		const line = state.doc.lineAt(pos);
		const prefix = LINE_PREFIX.exec(line.text)?.[0].length ?? 0;
		const indent = line.text.length - line.text.trimStart().length;
		const a = Math.max(pos, line.from + Math.max(prefix, indent));
		let b = Math.min(to, line.to);
		while (b > a && /\s/.test(state.doc.sliceString(b - 1, b))) b--;
		if (b > a) out.push({ from: a, to: b });
		pos = line.to + 1;
	}
	return out;
}

const TAIL = Decoration.mark({ class: 'mg-tail', inclusiveEnd: true });

/** Where the passage's last word starts. */
function lastWord(state: EditorState, from: number, to: number): number {
	const line = state.doc.lineAt(to);
	const text = line.text.slice(0, to - line.from);
	const start = line.from + text.search(/\S*$/);
	return Math.max(from, start);
}

function build(state: EditorState): DecorationSet {
	const model = state.field(notesField);
	const draft = state.field(draftField, false);
	if (!model.section && !draft) return Decoration.none;
	const active = activeLabel(state);
	const hover = state.field(hoverField, false);
	const ranges: { from: number; to: number; deco: Decoration }[] = [];

	for (const n of model.notes) {
		if (!n.anchor) continue;
		const on = n.label === active;
		const hovered = n.label === hover;
		const cls =
			'mg-passage' + (n.question ? ' is-question' : '') + (on ? ' is-active' : '') + (hovered ? ' is-hover' : '');
		const mark = Decoration.mark({ class: cls, attributes: { 'data-mg-label': n.label } });
		for (const r of textRanges(state, n.anchor.from, n.anchor.to)) ranges.push({ ...r, deco: mark });
		const widget = new MarkerWidget(n.label, n.index, n.question, on, hovered);
		// Before the cursor at the passage's end (side < 0), so it's drawn inside
		// the tail mark below; numbers of passages ending together stay in order.
		ranges.push({ from: n.anchor.to, to: n.anchor.to, deco: Decoration.widget({ widget, side: n.index - 1e4 }) });
		// The last word and its number, kept on one line.
		const tail = lastWord(state, n.anchor.from, n.anchor.to);
		if (tail < n.anchor.to) ranges.push({ from: tail, to: n.anchor.to, deco: TAIL });
	}

	// The passage of a note being written.
	if (draft) {
		const mark = Decoration.mark({ class: 'mg-passage mg-draft is-active', attributes: { 'data-mg-label': DRAFT } });
		for (const r of textRanges(state, draft.from, draft.to)) ranges.push({ ...r, deco: mark });
	}

	// The notes section: hidden in Live Preview unless the cursor is in it.
	if (model.section && isLivePreview(state) && state.facet(settingsFacet).hideSection) {
		const from = state.doc.lineAt(model.section.from).to + 1;
		const to = state.doc.length;
		const touched = state.selection.ranges.some((r) => r.from <= to && r.to >= from);
		if (from < to && !touched) {
			ranges.push({ from, to, deco: Decoration.replace({ widget: new HiddenSectionWidget(), block: true }) });
		}
	}

	ranges.sort((a, b) => a.from - b.from || a.deco.startSide - b.deco.startSide);
	const builder = new RangeSetBuilder<Decoration>();
	for (const r of ranges) builder.add(r.from, r.to, r.deco);
	return builder.finish();
}

/** In a state field (not a view plugin) because hiding the section replaces whole lines. */
export const decorationsField = StateField.define<DecorationSet>({
	create: build,
	update(deco, tr) {
		const changed =
			tr.docChanged ||
			tr.selection ||
			tr.effects.some((e) => e.is(setActive) || e.is(setHover) || e.is(editNote) || e.is(startDraft) || e.is(endDraft)) ||
			isLivePreview(tr.startState) !== isLivePreview(tr.state) ||
			tr.startState.facet(settingsFacet) !== tr.state.facet(settingsFacet);
		return changed ? build(tr.state) : deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});

/** The passage style, as a class on the editor (styles.css). */
export const passageStyle = EditorView.editorAttributes.compute([settingsFacet], (state) => ({
	class: `mg-style-${state.facet(settingsFacet).passageStyle}`,
}));
