/**
 * The margin: a column of note cards beside their passages. Crowded notes are
 * shortened to one line; the selected note always shows in full. In panes too
 * narrow for a margin, a note opens as a popover under its passage.
 */
import { EditorView, PluginValue, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { editorInfoField, Menu } from 'obsidian';
import { CardHost, NoteCard } from '../card';
import { Model } from '../format';
import { highlights } from '../render/highlights';
import { deleteNote, saveDraft, saveNote, trackView } from './actions';
import { noteUnderPointer } from './hover';
import { chooseMode, Item, measure, Mode, placeColumn, placePopover } from './placement';
import {
	activeField,
	DRAFT,
	Draft,
	draftField,
	editNote,
	hoverField,
	notesField,
	setActive,
	setHover,
	settingsFacet,
} from './state';
import { WidgetPassages } from './widgets';

class MarginView implements PluginValue, CardHost {
	private layer: HTMLElement;
	private cards = new Map<string, NoteCard>();
	private model: Model;
	private draft: Draft | null = null;
	private mode: Mode = 'none';
	/** In narrow panes, the note shown as a popover. */
	private open: string | null = null;
	/** Focus this card's field once it has been placed (otherwise the page scrolls to it). */
	private pendingEdit: string | null = null;
	private widgets: WidgetPassages;
	private observer: ResizeObserver;
	private width = -1;
	/** The pane width the mode was last re-chosen at because the margin didn't fit. */
	private refit = -1;
	private frames = { mode: 0, paint: 0, hover: 0 };
	private scheduled = false;

	constructor(readonly view: EditorView) {
		trackView(view, view.state.field(editorInfoField, false) ?? null);
		this.layer = view.scrollDOM.createDiv({ cls: 'mg-margin' });
		this.model = view.state.field(notesField);
		this.widgets = new WidgetPassages(view);
		this.syncCards();
		this.observer = new ResizeObserver(() => {
			if (view.scrollDOM.clientWidth === this.width) return;
			this.width = view.scrollDOM.clientWidth;
			this.queueMode(); // after the text has settled into the new width
		});
		this.observer.observe(view.scrollDOM);
		view.dom.doc.addEventListener('mousedown', this.closePopover, true);
		this.queueMode();
	}

	get app() {
		return this.view.state.field(editorInfoField).app;
	}

	sourcePath() {
		return this.view.state.field(editorInfoField).file?.path ?? '';
	}

	update(u: ViewUpdate) {
		const hadCards = this.cards.size > 0;
		const model = u.state.field(notesField);
		if (model !== this.model) {
			this.model = model;
			this.syncCards();
		}
		this.syncDraft(u.state.field(draftField));
		for (const tr of u.transactions) for (const e of tr.effects) if (e.is(editNote)) this.startEdit(e.value);
		const settingsChanged = u.startState.facet(settingsFacet) !== u.state.facet(settingsFacet);
		if (settingsChanged || hadCards !== this.cards.size > 0) this.queueMode();
		const hover = u.state.field(hoverField);
		if (hover !== u.startState.field(hoverField)) this.showHover(hover);
		if (u.docChanged || u.geometryChanged || u.viewportChanged || u.selectionSet || u.transactions.some((t) => t.effects.length)) {
			this.schedule();
		}
	}

	destroy() {
		const win = this.view.dom.win;
		for (const f of Object.values(this.frames)) win.cancelAnimationFrame(f);
		this.observer.disconnect();
		this.view.dom.doc.removeEventListener('mousedown', this.closePopover, true);
		this.widgets.destroy();
		highlights.setHover(this.view.dom, null);
		for (const card of this.cards.values()) card.unload();
		this.layer.remove();
		this.view.scrollDOM.removeClass('mg-reserve');
	}

	// --- Cards --------------------------------------------------------------

	private newCard(label: string): NoteCard {
		const card = new NoteCard(this, label, this.layer);
		card.load();
		this.cards.set(label, card);
		return card;
	}

	private syncCards() {
		const seen = new Set<string>([DRAFT]);
		for (const n of this.model.notes) {
			if (!n.anchor) continue;
			seen.add(n.label);
			(this.cards.get(n.label) ?? this.newCard(n.label)).update(n.index, n.text, n.question);
		}
		for (const [label, card] of this.cards) {
			if (seen.has(label) || card.editing) continue;
			card.unload();
			this.cards.delete(label);
		}
	}

	private syncDraft(draft: Draft | null) {
		if (draft === this.draft) return;
		const opened = draft && !this.draft;
		this.draft = draft;
		if (!draft) {
			this.cards.get(DRAFT)?.unload();
			this.cards.delete(DRAFT);
			if (this.open === DRAFT) this.open = null;
		} else if (opened) {
			this.newCard(DRAFT).update(draft.index, '', false);
			this.cards.get(DRAFT)?.el.addClass('is-draft');
			this.startEdit(DRAFT);
		}
	}

	/** Notes and the draft, in document order. */
	private items(): Item[] {
		const items: Item[] = this.model.notes.flatMap((n) => (n.anchor ? [{ label: n.label, ...n.anchor }] : []));
		const d = this.draft;
		if (d) {
			const at = items.findIndex((i) => i.from > d.from);
			items.splice(at === -1 ? items.length : at, 0, { label: DRAFT, from: d.from, to: d.to });
		}
		return items;
	}

	private startEdit(label: string) {
		if (this.mode === 'narrow') this.open = label;
		this.pendingEdit = label;
		this.schedule();
	}

	/** Focus a card's field after placing it. We're inside CodeMirror's update, so on the next tick. */
	private flushPendingEdit() {
		const label = this.pendingEdit;
		this.pendingEdit = null;
		if (label) this.view.dom.win.setTimeout(() => this.cards.get(label)?.edit(), 0);
	}

	// CardHost
	select(label: string) {
		if (this.view.state.field(activeField) !== label) this.view.dispatch({ effects: setActive.of(label) });
	}

	commit(label: string, text: string) {
		if (label === DRAFT) saveDraft(this.view, text);
		else saveNote(this.view, label, text);
		this.afterEdit();
	}

	cancel(label: string) {
		if (label === DRAFT) saveDraft(this.view, '');
		this.afterEdit();
	}

	remove(label: string) {
		this.cards.get(label)?.stopEditing();
		if (label === DRAFT) saveDraft(this.view, '');
		else deleteNote(this.view, label);
		this.afterEdit();
	}

	/** Back to the text, unless focus went somewhere else (another pane, another note). */
	private afterEdit() {
		this.open = null;
		this.schedule();
		const doc = this.view.dom.doc;
		this.view.dom.win.setTimeout(() => {
			if (!doc.activeElement || doc.activeElement === doc.body) this.view.focus();
		}, 0);
	}

	resized() {
		this.schedule();
	}

	hover(label: string, on: boolean) {
		this.setHover(on ? label : null);
	}

	// --- Pointer -------------------------------------------------------------

	markerClicked(label: string) {
		if (this.mode === 'narrow') {
			this.open = this.open === label ? null : label;
			this.schedule();
		}
		this.view.dispatch({ effects: setActive.of(label) });
	}

	markerMenu(label: string, e: MouseEvent) {
		new Menu()
			.addItem((i) =>
				i
					.setTitle('Edit note')
					.setIcon('message-square')
					.onClick(() => this.view.dispatch({ effects: editNote.of(label) })),
			)
			.addItem((i) =>
				i
					.setTitle('Delete note')
					.setIcon('trash-2')
					.setWarning(true)
					.onClick(() => this.remove(label)),
			)
			.showAtMouseEvent(e);
	}

	/** A click anywhere but a note or marker closes the popover. */
	private closePopover = (e: MouseEvent) => {
		if (!this.open || !(e.target instanceof Element) || e.target.closest('.mg-note, .mg-marker')) return;
		this.open = null;
		this.schedule();
	};

	pointerMoved(e: MouseEvent) {
		const target = e.target;
		if (!(target instanceof Element)) return;
		const win = this.view.dom.win;
		win.cancelAnimationFrame(this.frames.hover);
		this.frames.hover = win.requestAnimationFrame(() =>
			this.setHover(noteUnderPointer(this.view, this.model, target, e.clientX, e.clientY)),
		);
	}

	pointerLeft() {
		this.view.dom.win.cancelAnimationFrame(this.frames.hover);
		this.setHover(null);
	}

	private setHover(label: string | null) {
		if (this.view.state.field(hoverField) !== label) this.view.dispatch({ effects: setHover.of(label) });
	}

	private showHover(label: string | null) {
		for (const [l, card] of this.cards) card.el.toggleClass('is-hover', l === label);
		highlights.setHover(this.view.dom, label);
	}

	// --- Layout -------------------------------------------------------------

	/** Decide the mode once the current update is over (it reads and changes the page's layout). */
	private queueMode() {
		const win = this.view.dom.win;
		win.cancelAnimationFrame(this.frames.mode);
		this.frames.mode = win.requestAnimationFrame(() => this.decideMode());
	}

	private decideMode() {
		const mode = chooseMode(this.view, this.cards.size > 0);
		if (mode !== this.mode) this.open = mode === 'narrow' ? this.pendingEdit : null;
		this.mode = mode;
		this.layer.dataset.mode = mode;
		this.schedule();
	}

	private schedule() {
		if (this.scheduled) return;
		this.scheduled = true;
		this.view.requestMeasure({
			key: this,
			read: () => {
				this.scheduled = false;
				return this.mode === 'none' ? null : measure(this.view, this.items(), this.cards, this.widgets.starts);
			},
			write: (m) => {
				if (!m) return;
				if (this.mode === 'narrow') placePopover(m, this.cards, this.open);
				else if (!placeColumn(this.view, m, this.items(), this.cards) && this.refit !== m.clientWidth) {
					this.refit = m.clientWidth;
					this.queueMode();
				}
				this.paintWidgets();
				this.flushPendingEdit();
			},
		});
	}

	private paintWidgets() {
		const win = this.view.dom.win;
		win.cancelAnimationFrame(this.frames.paint);
		this.frames.paint = win.requestAnimationFrame(() => {
			if (this.widgets.paint(this.model)) this.schedule();
		});
	}
}

const markerLabel = (e: Event) =>
	(e.target instanceof Element ? e.target.closest<HTMLElement>('.mg-marker') : null)?.dataset.mgLabel;

export const marginPlugin = ViewPlugin.fromClass(MarginView, {
	eventHandlers: {
		mousedown(e) {
			const label = markerLabel(e);
			if (!label || e.button !== 0) return false;
			e.preventDefault();
			this.markerClicked(label);
			return true;
		},
		contextmenu(e) {
			const label = markerLabel(e);
			if (!label) return false;
			e.preventDefault();
			this.markerMenu(label, e);
			return true;
		},
		mousemove(e) {
			this.pointerMoved(e);
		},
		mouseleave() {
			this.pointerLeft();
		},
	},
});
