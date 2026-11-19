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
		for (const [owner, notes] of this.byOwner) {
			if (!owner.isConnected) continue; // not on the page right now
			const doc = owner.ownerDocument;
			let s = sets.get(doc);
			if (!s) sets.set(doc, (s = { 'mg-passage': [], 'mg-passage-q': [], 'mg-hover': [], 'mg-hover-q': [] }));
			for (const { label, p, ranges } of this.resolve(owner, notes)) {
				const name = `${this.isHovered(owner, label) ? 'mg-hover' : 'mg-passage'}${p.question ? '-q' : ''}` as const;
				s[name].push(...ranges);
			}
		}
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

	reset() {
		this.byOwner.clear();
		this.hovered.clear();
		this.paint();
	}
}

/** One registry for every view and window. */
export const highlights = new Highlights();
