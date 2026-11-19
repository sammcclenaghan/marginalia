/**
 * The sidebar: every note in the open file, in passage order. Click one to go
 * to its passage. Notes whose passage can't be found are listed apart, to be
 * attached to a new passage or deleted: nowhere else shows them. Like
 * Reading view, the panel only changes notes while the file is being edited.
 */
import type { EditorView } from '@codemirror/view';
import { Component, debounce, ItemView, MarkdownView, setIcon, WorkspaceLeaf } from 'obsidian';
import { followLink, renderNote } from './card';
import { deleteNote, reattachNote, revealNote, viewFor } from './editor/actions';
import { buildModel, Model, norm, Note } from './format';

export const PANEL_VIEW = 'marginalia-notes';

export class NotesPanel extends ItemView {
	private list!: HTMLElement;
	/** The note shown, and its text when the list was drawn. */
	private source: MarkdownView | null = null;
	private drawn: string | null = null;
	/** Owns the rendered notes; replaced on each redraw. */
	private content: Component | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType() {
		return PANEL_VIEW;
	}

	getDisplayText() {
		return 'Margin notes';
	}

	getIcon() {
		return 'message-square-quote';
	}

	async onOpen() {
		this.contentEl.addClass('mg-panel');
		this.list = this.contentEl.createDiv({ cls: 'mg-panel-list' });
		const later = debounce(() => this.refresh(), 250, true);
		const { workspace } = this.app;
		this.registerEvent(workspace.on('active-leaf-change', () => this.refresh()));
		this.registerEvent(workspace.on('layout-change', () => this.refresh()));
		this.registerEvent(workspace.on('editor-change', later));
		this.registerEvent(this.app.vault.on('modify', (file) => file === this.source?.file && later()));
		this.refresh();
	}

	async onClose() {
		this.content?.unload();
	}

	/** The open note: the active one, or the last one used (while the panel itself has focus). */
	private markdownView(): MarkdownView | null {
		const active = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (active) return active;
		const recent = this.app.workspace.getMostRecentLeaf()?.view;
		return recent instanceof MarkdownView ? recent : null;
	}

	private refresh() {
		const view = this.markdownView();
		const text = view?.getViewData() ?? '';
		const key = `${view?.file?.path ?? ''}\u0000${text}`;
		if (view === this.source && key === this.drawn) return;
		this.source = view;
		this.drawn = key;
		this.draw(buildModel(text.replace(/\r\n/g, '\n')));
	}

	private draw(model: Model) {
		this.content?.unload();
		this.content = new Component();
		this.content.load();
		this.list.empty();
		const notes = model.notes.filter((n) => n.anchor);
		const lost = model.notes.filter((n) => !n.anchor);
		if (notes.length === 0 && lost.length === 0) {
			this.list.createDiv({ cls: 'mg-panel-empty', text: this.source ? 'No notes in this file.' : 'No file open.' });
			return;
		}
		for (const n of notes) {
			const item = this.item(n);
			item.addClass('is-clickable');
			// Notes on a passage inside another note's passage sit under it.
			const depth = notes.filter((o) => o !== n && o.index < n.index && o.anchor && n.anchor && o.anchor.from <= n.anchor.from && o.anchor.to >= n.anchor.to).length;
			if (depth) item.setCssProps({ '--mg-depth': String(depth) });
			item.addEventListener('click', (e) => {
				if (!followLink(this.app, e, this.path())) this.reveal(n.label);
			});
		}
		if (lost.length) this.drawLost(lost);
	}

	private item(n: Note, parent = this.list): HTMLElement {
		const item = parent.createDiv({ cls: 'mg-panel-item' });
		item.toggleClass('is-question', n.question);
		if (n.anchor) item.createSpan({ cls: 'mg-note-num', text: String(n.index) });
		item.createDiv({ cls: 'mg-panel-passage', text: norm(n.passage) });
		const body = item.createDiv({ cls: 'mg-panel-body markdown-rendered' });
		if (n.text && this.content) void renderNote(this.app, n.text, body, this.path(), this.content);
		else body.createSpan({ cls: 'mg-placeholder', text: 'Empty note' });
		return item;
	}

	/** Notes whose passage is gone (its words were rewritten elsewhere). */
	private drawLost(lost: Note[]) {
		const group = this.list.createDiv({ cls: 'mg-panel-lost' });
		group.createDiv({
			cls: 'mg-panel-lost-title',
			text: lost.length === 1 ? 'Lost its passage' : `${lost.length} lost their passage`,
		});
		const editor = this.editor();
		for (const n of lost) {
			const item = this.item(n, group);
			item.addClass('is-lost');
			if (!editor) continue;
			const actions = item.createDiv({ cls: 'mg-panel-actions' });
			const attach = actions.createEl('button', { text: 'Attach to selection' });
			attach.addEventListener('click', () => reattachNote(editor, n.label));
			const remove = actions.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Delete note' } });
			setIcon(remove, 'trash-2');
			remove.addEventListener('click', () => deleteNote(editor, n.label));
		}
	}

	private path() {
		return this.source?.file?.path ?? '';
	}

	/** Go to a note's passage: selected in the editor, or scrolled to in Reading view. */
	private reveal(label: string) {
		const source = this.source;
		if (!source) return;
		this.app.workspace.setActiveLeaf(source.leaf, { focus: true });
		const editor = this.editor();
		if (editor) return revealNote(editor, label);
		source.previewMode.containerEl
			.querySelector(`.mg-side[data-mg-label="${CSS.escape(label)}"]`)
			?.scrollIntoView({ block: 'center' });
	}

	/** The note's editor, if it's being edited (changes then go through it, so they can be undone). */
	private editor(): EditorView | null {
		const source = this.source;
		return source?.getMode() === 'source' ? viewFor(source) : null;
	}
}
