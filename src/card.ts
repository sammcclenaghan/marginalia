/**
 * A note in the margin: a hanging number and the note, rendered as Markdown.
 * Click it to edit it in place: a flat field, Enter to save, Esc to cancel.
 */
import { App, Component, Keymap, MarkdownRenderer, setIcon } from 'obsidian';

export interface CardHost {
	app: App;
	sourcePath(): string;
	/** The card was clicked. */
	select(label: string): void;
	hover(label: string, on: boolean): void;
	/** The card's size may have changed. */
	resized(): void;
	commit(label: string, text: string): void;
	cancel(label: string): void;
	remove(label: string): void;
}

/** Render a note into `el`, unwrapping a lone paragraph so it reads inline. */
export async function renderNote(app: App, text: string, el: HTMLElement, sourcePath: string, component: Component) {
	const tmp = createDiv();
	await MarkdownRenderer.render(app, text, tmp, sourcePath, component);
	const only = tmp.childElementCount === 1 ? tmp.firstElementChild : null;
	const from = only?.tagName === 'P' ? only : tmp;
	el.empty();
	el.append(...Array.from(from.childNodes));
}

/** Open internal links in notes; external links are left to Obsidian. True if a link was clicked. */
export function followLink(app: App, evt: MouseEvent, sourcePath: string): boolean {
	const a = evt.target instanceof Element ? evt.target.closest('a') : null;
	if (!a) return false;
	if (a.hasClass('internal-link')) {
		evt.preventDefault();
		const href = a.getAttr('data-href') ?? a.getAttr('href') ?? '';
		void app.workspace.openLinkText(href, sourcePath, Keymap.isModEvent(evt));
	}
	return true;
}

export class NoteCard extends Component {
	readonly el: HTMLElement;
	readonly body: HTMLElement;
	private num: HTMLElement;
	/** Owns what the rendered Markdown needs (embeds, links); replaced on each render. */
	private content: Component | null = null;
	private rendered: string | null = null;
	private input: HTMLTextAreaElement | null = null;
	text = '';

	constructor(
		private host: CardHost,
		readonly label: string,
		parent: HTMLElement,
	) {
		super();
		this.el = parent.createDiv({ cls: 'mg-note is-entering' });
		this.el.dataset.mgLabel = label;
		this.num = this.el.createSpan({ cls: 'mg-note-num' });
		this.body = this.el.createDiv({ cls: 'mg-note-body markdown-rendered' });
	}

	onload() {
		const remove = this.el.createEl('button', { cls: 'mg-note-delete clickable-icon', attr: { 'aria-label': 'Delete note' } });
		setIcon(remove, 'trash-2');
		// Keep the field focused until the click lands.
		this.registerDomEvent(remove, 'mousedown', (e) => e.preventDefault());
		this.registerDomEvent(remove, 'click', (e) => {
			e.stopPropagation();
			this.host.remove(this.label);
		});
		// Keep clicks away from the editor underneath.
		this.registerDomEvent(this.el, 'mousedown', (e) => e.stopPropagation());
		this.registerDomEvent(this.el, 'mouseenter', () => this.host.hover(this.label, true));
		this.registerDomEvent(this.el, 'mouseleave', () => this.host.hover(this.label, false));
		this.registerDomEvent(this.body, 'click', (e) => {
			if (this.input) return;
			if (followLink(this.host.app, e, this.host.sourcePath())) return;
			this.host.select(this.label);
			this.edit();
		});
	}

	onunload() {
		this.input = null; // leaving without saving: the note is gone
		this.el.remove();
	}

	get editing() {
		return this.input !== null;
	}

	update(index: number, text: string, question: boolean) {
		this.text = text;
		this.num.setText(String(index));
		this.el.toggleClass('is-question', question);
		if (!this.input) this.render();
	}

	private render() {
		if (this.rendered === this.text) return;
		this.rendered = this.text;
		if (this.content) this.removeChild(this.content);
		this.content = this.addChild(new Component());
		if (this.text === '') {
			this.body.empty();
			this.body.createSpan({ cls: 'mg-placeholder', text: 'Empty note' });
			this.host.resized();
			return;
		}
		void renderNote(this.host.app, this.text, this.body, this.host.sourcePath(), this.content).then(() =>
			this.host.resized(),
		);
	}

	edit() {
		if (this.input) {
			this.input.focus({ preventScroll: true });
			return;
		}
		this.el.addClass('is-editing');
		this.body.empty();
		this.rendered = null;
		const input = (this.input = this.body.createEl('textarea', {
			cls: 'mg-note-input',
			attr: { rows: '1', placeholder: 'Add a note or question', spellcheck: 'true' },
		}));
		input.value = this.text;
		const grow = () => {
			input.setCssProps({ height: 'auto' });
			input.setCssProps({ height: `${input.scrollHeight}px` });
			this.host.resized();
		};
		// Plain listeners: the field and its listeners go away together when editing ends.
		input.addEventListener('input', grow);
		input.addEventListener('keydown', (e) => {
			e.stopPropagation();
			if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
				e.preventDefault();
				this.finish(true);
			} else if (e.key === 'Escape') {
				e.preventDefault();
				this.finish(false);
			}
		});
		input.addEventListener('blur', () => this.finish(true));
		input.focus({ preventScroll: true });
		input.setSelectionRange(input.value.length, input.value.length);
		grow();
	}

	/** Leave the field without saving (the note is being deleted). */
	stopEditing() {
		if (!this.input) return;
		this.input = null; // before the field goes, so its blur doesn't save
		this.el.removeClass('is-editing');
		this.render();
	}

	private finish(save: boolean) {
		const input = this.input;
		if (!input) return;
		this.input = null;
		if (save) this.text = input.value.trim();
		this.el.removeClass('is-editing');
		this.render();
		if (save) this.host.commit(this.label, input.value);
		else this.host.cancel(this.label);
	}

	setCollapsed(on: boolean) {
		this.el.toggleClass('is-collapsed', on);
	}

	/** Shown once the card has been placed. */
	reveal() {
		this.el.removeClass('is-entering');
	}
}
