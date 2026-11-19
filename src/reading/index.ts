/** Marginalia in Reading view. */
import { MarkdownPostProcessorContext, MarkdownView } from 'obsidian';
import { buildModel, Model, Note } from '../format';
import type MarginaliaPlugin from '../main';
import { highlights } from '../render/highlights';
import { ReadingLayout } from './layout';
import { renderSection } from './render';

interface Parsed {
	text: string;
	model: Model;
}

/** What rendered notes depend on: a change means re-rendering the annotated sections. */
const signature = (notes: Note[]) =>
	notes.map((n) => [n.entry.quote, n.entry.prefix, n.entry.suffix, n.text, n.index].join('\u0001')).join('\u0002');

export class ReadingNotes {
	/** The last parse of each file, as Reading view rendered it. */
	private cache = new Map<string, Parsed>();
	private layouts = new Map<HTMLElement, ReadingLayout>();
	private rerenderTimer = 0;

	constructor(private plugin: MarginaliaPlugin) {}

	private get app() {
		return this.plugin.app;
	}

	register() {
		const { plugin } = this;
		plugin.registerMarkdownPostProcessor((el, ctx) => this.process(el, ctx));
		plugin.registerEvent(plugin.app.workspace.on('layout-change', () => this.attachAll()));
		plugin.registerEvent(plugin.app.vault.on('rename', (_file, old) => this.cache.delete(old)));
		plugin.app.workspace.onLayoutReady(() => this.attachAll());
	}

	/** Settings changed: lay out and render every Reading view again. */
	refresh() {
		this.cache.clear();
		highlights.reset();
		if (!this.plugin.settings.readingView) {
			for (const layout of this.layouts.values()) this.plugin.removeChild(layout);
			this.layouts.clear();
		}
		this.attachAll();
		for (const layout of this.layouts.values()) layout.layout();
		this.rerender(() => true);
	}

	unload() {
		window.clearTimeout(this.rerenderTimer);
		for (const layout of this.layouts.values()) this.plugin.removeChild(layout);
		this.layouts.clear();
		this.rerender(() => true); // without our markers and notes
	}

	private rerender(which: (view: MarkdownView) => boolean) {
		this.app.workspace.iterateAllLeaves((leaf) => {
			const v = leaf.view;
			if (v instanceof MarkdownView && v.getMode() === 'preview' && which(v)) v.previewMode.rerender(true);
		});
	}

	// --- Rendering -----------------------------------------------------------

	private process(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		if (!this.plugin.settings.readingView) return;
		const info = ctx.getSectionInfo(el);
		if (!info) return; // not part of a file (an embed, a hover preview)
		const parsed = this.parse(ctx.sourcePath, info.text);
		if (!parsed.model.section) return;
		return renderSection(el, ctx, parsed.text, parsed.model, {
			app: this.app,
			hover: (el, label) => this.layoutOf(el)?.setHover(label),
			changed: () => {
				for (const layout of this.layouts.values()) layout.schedulePass();
			},
		});
	}

	/**
	 * Reading view renders the editor's text, which can be newer than the file
	 * on disk, so parse what it renders. When the notes change (here, or in
	 * another pane) Obsidian re-renders only the changed section at the end,
	 * so render the whole note again.
	 */
	private parse(path: string, text: string): Parsed {
		const hit = this.cache.get(path);
		if (hit?.text === text) return hit;
		const parsed = { text, model: buildModel(text) };
		this.cache.set(path, parsed);
		if (hit && signature(hit.model.notes) !== signature(parsed.model.notes)) {
			window.clearTimeout(this.rerenderTimer);
			this.rerenderTimer = window.setTimeout(() => this.rerender((v) => v.file?.path === path), 50);
		}
		return parsed;
	}

	// --- Views ---------------------------------------------------------------

	private attachAll() {
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) this.attach(leaf.view);
		});
		// Forget views that have closed.
		for (const [container, layout] of this.layouts) {
			if (container.isConnected) continue;
			this.plugin.removeChild(layout);
			this.layouts.delete(container);
		}
	}

	private attach(view: MarkdownView) {
		const container = view.previewMode.containerEl;
		const scroller = container.querySelector<HTMLElement>('.markdown-preview-view');
		if (!scroller || this.layouts.has(container) || !this.plugin.settings.readingView) return;
		const layout = new ReadingLayout(container, scroller, { settings: () => this.plugin.settings });
		this.layouts.set(container, this.plugin.addChild(layout));
	}

	private layoutOf(el: HTMLElement): ReadingLayout | null {
		for (const [container, layout] of this.layouts) if (container.contains(el)) return layout;
		return null;
	}
}
