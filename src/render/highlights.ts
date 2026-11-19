/**
 * Passages painted with the CSS Custom Highlight API: they can overlap and
 * span blocks without changing the page. Used where CodeMirror marks can't
 * reach (Live Preview widgets) and in Reading view.
 */
import { findText, indexText, TextIndex, textRange } from './text';

/** How to find a passage's words again inside the element it was found in. */
interface Recipe {
	q: string;
	k: number;
}

interface Painted {
	recipes: Recipe[];
	question: boolean;
	ranges: Range[] | null;
}

const NAMES = ['mg-passage', 'mg-passage-q', 'mg-hover', 'mg-hover-q'] as const;

/**
 * Inside passages, things the browser won't underline for a highlight: inline
 * formulas (not text) and spaces between elements (wrapped as .mg-space in
 * Reading view). styles.css draws their underline (.mg-drawn).
 */
const DRAWN = '.math, .mg-space';
const DRAWN_CLASSES = ['mg-drawn', 'mg-drawn-q', 'mg-drawn-hover'];
type Name = (typeof NAMES)[number];

/**
 * Painted passages, grouped by the element they were found in (a Reading view
 * section or a Live Preview widget). Ranges die when their element is
 * detached (Reading view detaches sections that scroll far away and attaches
 * the same elements again later), so each passage keeps a recipe and its
 * ranges are rebuilt whenever they've collapsed.
 */
class Highlights {
	private byOwner = new Map<Element, Map<string, Painted>>();
	/** The hovered note in each view: editors and Reading views hover independently. */
	private hovered = new Map<Element, string>();
	private docs = new Set<Document>();
	/** Elements whose underline styles.css currently draws. */
	private drawn = new Set<Element>();
	private frame = 0;

	add(owner: Element, label: string, q: string, k: number, question: boolean) {
		let notes = this.byOwner.get(owner);
		if (!notes) this.byOwner.set(owner, (notes = new Map<string, Painted>()));
		const p = notes.get(label) ?? { recipes: [], question, ranges: null };
		p.recipes.push({ q, k });
		p.ranges = null;
		notes.set(label, p);
	}

	clear(owner: Element) {
		this.byOwner.delete(owner);
	}

	private ranges(owner: Element, p: Painted, index: () => TextIndex): Range[] {
		if (p.ranges?.every((r) => !r.collapsed && owner.contains(r.startContainer))) return p.ranges;
		const out: Range[] = [];
		for (const { q, k } of p.recipes) {
			const at = findText(index(), q, k);
			const r = at && textRange(index(), at.start, at.end);
			if (r) out.push(r);
		}
		return (p.ranges = out);
	}

	private resolve(owner: Element, notes: Map<string, Painted>) {
		let idx: TextIndex | null = null;
		const index = () => (idx ??= indexText(owner));
		return [...notes].map(([label, p]) => ({ label, p, ranges: this.ranges(owner, p, index) }));
	}

	/** Labels whose passage contains the point, innermost first. */
	at(container: Element, node: Node, offset: number): string[] {
		const hits: { label: string; size: number }[] = [];
		for (const [owner, notes] of this.byOwner) {
			if (!owner.isConnected || !container.contains(owner)) continue;
			for (const { label, ranges } of this.resolve(owner, notes)) {
				for (const r of ranges) {
					try {
						if (r.isPointInRange(node, offset)) hits.push({ label, size: r.toString().length });
					} catch {
						// The point is in another document.
					}
				}
			}
		}
		return hits.sort((a, b) => a.size - b.size).map((h) => h.label);
	}

	/** The innermost passage under a point on screen (null where the browser can't tell). */
	atPoint(container: Element, x: number, y: number): string | null {
		const doc: Partial<Pick<Document, 'caretPositionFromPoint'>> = container.doc;
		// Older iOS WebKit lacks it, and taps there still send mouse events.
		const at = doc.caretPositionFromPoint?.(x, y);
		return at ? (this.at(container, at.offsetNode, at.offset)[0] ?? null) : null;
	}

	setHover(container: Element, label: string | null) {
		if (this.hovered.get(container) === (label ?? undefined)) return;
		if (label) this.hovered.set(container, label);
		else this.hovered.delete(container);
		this.paint();
	}

	private isHovered(owner: Element, label: string) {
		for (const [c, l] of this.hovered) if (l === label && c.contains(owner)) return true;
		return false;
	}

	/** Repaint on the next frame (after new sections are on the page, or on scroll). */
	schedule() {
		window.cancelAnimationFrame(this.frame);
		this.frame = window.requestAnimationFrame(() => this.paint());
	}

	paint() {
		const sets = new Map<Document, Record<Name, Range[]>>();
		const drawn = new Map<Element, { question: boolean; hover: boolean }>();
		for (const [owner, notes] of this.byOwner) {
			if (!owner.isConnected) continue; // not on the page right now
			const doc = owner.ownerDocument;
			let s = sets.get(doc);
			if (!s) sets.set(doc, (s = { 'mg-passage': [], 'mg-passage-q': [], 'mg-hover': [], 'mg-hover-q': [] }));
			// In Live Preview the painted element can be the formula itself.
			const inline = [...(owner.matches(DRAWN) ? [owner] : []), ...Array.from(owner.querySelectorAll(DRAWN))].filter(
				(el) => getComputedStyle(el).display === 'inline',
			);
			for (const { label, p, ranges } of this.resolve(owner, notes)) {
				const hover = this.isHovered(owner, label);
				const name = `${hover ? 'mg-hover' : 'mg-passage'}${p.question ? '-q' : ''}` as const;
				s[name].push(...ranges);
				for (const el of inline) {
					if (!ranges.some((r) => r.intersectsNode(el))) continue;
					// Where passages overlap, the hovered one shows.
					if (!drawn.get(el)?.hover) drawn.set(el, { question: p.question, hover });
				}
			}
		}
		this.markDrawn(drawn);
		for (const doc of new Set([...this.docs, ...sets.keys()])) {
			const win = doc.defaultView;
			// TypeScript's DOM types don't include the registry's Map methods yet.
			const registry = win?.CSS.highlights as Map<string, Highlight> | undefined;
			if (!win || !registry) continue;
			const s = sets.get(doc);
			for (const name of NAMES) {
				const ranges = s?.[name] ?? [];
				if (ranges.length) registry.set(name, new win.Highlight(...ranges));
				else registry.delete(name);
			}
		}
		this.docs = new Set(sets.keys());
	}

	/** Mark the elements whose underline styles.css draws, with their passage's state. */
	private markDrawn(drawn: Map<Element, { question: boolean; hover: boolean }>) {
		for (const el of this.drawn) if (!drawn.has(el)) el.removeClass(...DRAWN_CLASSES);
		for (const [el, state] of drawn) {
			el.addClass('mg-drawn');
			el.toggleClass('mg-drawn-q', state.question);
			el.toggleClass('mg-drawn-hover', state.hover);
			// The height of its text box: the underline's spaces fill it exactly,
			// so they sit on the same baseline as the text around it.
			const height = `${el.getBoundingClientRect().height}px`;
			if (el.instanceOf(HTMLElement) && el.style.getPropertyValue('--mg-drawn-line') !== height) {
				el.setCssProps({ '--mg-drawn-line': height });
			}
		}
		this.drawn = new Set(drawn.keys());
	}

	reset() {
		this.byOwner.clear();
		this.hovered.clear();
		this.paint();
	}
}

/** One registry for every view and window. */
export const highlights = new Highlights();
