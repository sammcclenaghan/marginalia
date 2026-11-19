/** Margin layout maths. Pure, so it can be tested without Obsidian. */

/** Vertical gap between stacked notes. */
export const SPACING = 6;

/**
 * Which notes to shorten to one line. A note is shortened only when its full
 * text would push the next note away from that note's passage. The pinned
 * note (selected, or being edited) is never shortened.
 */
export function chooseCollapsed(ys: number[], full: number[], short: number[], pinned: number, tolerance = 12): boolean[] {
	const out = ys.map(() => false);
	let prevBottom = -Infinity;
	for (let i = 0; i < ys.length; i++) {
		const y = ys[i] ?? 0;
		const f = full[i] ?? 0;
		const s = short[i] ?? 0;
		const top = Math.max(y, prevBottom + SPACING);
		const next = ys[i + 1];
		const crowds = next !== undefined && top + f + SPACING > next + tolerance;
		out[i] = crowds && i !== pinned && s < f;
		prevBottom = top + (out[i] ? s : f);
	}
	return out;
}

/**
 * Place notes as close to their passages as possible without overlapping,
 * in document order. The pinned note (if any) sits exactly beside its
 * passage and pushes the others away.
 */
export function layoutStack(ys: number[], hs: number[], pinned: number): number[] {
	const n = ys.length;
	const tops = ys.slice();
	if (n === 0) return tops;
	const y = (i: number) => ys[i] ?? 0;
	const h = (i: number) => hs[i] ?? 0;
	const top = (i: number) => tops[i] ?? 0;
	const start = pinned >= 0 && pinned < n ? pinned : 0;
	for (let k = start + 1; k < n; k++) tops[k] = Math.max(y(k), top(k - 1) + h(k - 1) + SPACING);
	for (let k = start - 1; k >= 0; k--) tops[k] = Math.min(y(k), top(k + 1) - h(k) - SPACING);
	// Never run off the top: settle downwards again.
	if (top(0) < 0) {
		tops[0] = 0;
		for (let k = 1; k < n; k++) tops[k] = Math.max(top(k), top(k - 1) + h(k - 1) + SPACING);
	}
	return tops;
}
