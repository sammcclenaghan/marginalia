import { describe, expect, it } from "vitest";
import { chooseCollapsed, layoutStack, SPACING } from "../src/layout";

describe("layoutStack", () => {
	it("leaves notes beside their passages when there's room", () => {
		expect(layoutStack([0, 100, 200], [40, 40, 40], -1)).toEqual([0, 100, 200]);
	});

	it("pushes crowded notes down, in order", () => {
		expect(layoutStack([0, 10, 20], [40, 40, 40], -1)).toEqual([0, 40 + SPACING, 2 * (40 + SPACING)]);
	});

	it("keeps the pinned note beside its passage and pushes earlier ones up", () => {
		const tops = layoutStack([100, 110, 120], [40, 40, 40], 1);
		expect(tops[1]).toBe(110);
		expect(tops[0]).toBe(110 - 40 - SPACING);
		expect(tops[2]).toBe(110 + 40 + SPACING);
	});

	it("never runs off the top", () => {
		const tops = layoutStack([0, 5], [40, 40], 1);
		expect(tops[0]).toBe(0);
		expect(tops[1]).toBe(40 + SPACING);
	});
});

describe("chooseCollapsed", () => {
	it("leaves notes alone when nothing is crowded", () => {
		expect(chooseCollapsed([0, 200], [60, 60], [20, 20], -1)).toEqual([false, false]);
	});

	it("shortens a note that would push the next one off its passage", () => {
		expect(chooseCollapsed([0, 30], [80, 80], [20, 20], -1)).toEqual([true, false]);
	});

	it("never shortens the pinned note", () => {
		expect(chooseCollapsed([0, 30], [80, 80], [20, 20], 0)).toEqual([false, false]);
	});

	it("doesn't shorten a note that's already one line", () => {
		expect(chooseCollapsed([0, 10], [20, 20], [20, 20], -1)).toEqual([false, false]);
	});
});
