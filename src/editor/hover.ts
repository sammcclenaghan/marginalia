/** Which note's passage is under the pointer. */
import { EditorView } from '@codemirror/view';
import { Model, noteAt } from '../format';
import { highlights } from '../render/highlights';
import { WIDGET } from './widgets';

/**
 * Found from the nearest document position rather than the element under the
 * pointer, so the gaps between a passage's lines still count as the passage
 * (no flicker moving across it).
 */
export function noteUnderPointer(view: EditorView, model: Model, target: Element, x: number, y: number): string | null {
	const marker = target.closest<HTMLElement>('.mg-marker');
	if (marker) return marker.dataset.mgLabel ?? null;
	if (target.closest(WIDGET)) {
		// Rendered widgets: the painted passages know where their words are.
		const at = target.doc.caretPositionFromPoint(x, y);
		return at ? (highlights.at(view.dom, at.offsetNode, at.offset)[0] ?? null) : null;
	}
	if (target.closest('.cm-line')) return noteAt(model, view.posAtCoords({ x, y }, false))?.label ?? null;
	return null;
}
