import { describe, expect, it } from "vitest";
import {
	addEntry,
	anchorQuote,
	applyChanges,
	buildModel,
	MARKER,
	noteAt,
	parseSection,
	project,
	removeEntry,
	setBody,
	setQuote,
} from "../src/format";

const ARTICLE = `---
tags: [x]
---
# Deep Work

Deep work is the ability to focus **without distraction** on a cognitively demanding task.

It's a skill that allows you to quickly master [complicated information](https://x.y) and produce better results.

- Used for priority queues
- Used in [[Dijkstra|Dijkstra's algorithm]] and heapsort
`;

/** Add a note on the first occurrence of `sel` (or the nth). */
function add(doc: string, sel: string, body: string, nth = 0) {
	let i = -1;
	for (let k = 0; k <= nth; k++) i = doc.indexOf(sel, i + 1);
	const changes = addEntry(doc, buildModel(doc), { from: i, to: i + sel.length }, body);
	if (!changes) throw new Error("not added");
	return applyChanges(doc, changes);
}

const passageOf = (doc: string, label: string) => {
	const n = buildModel(doc).byLabel.get(label)!;
	return n.anchor ? doc.slice(n.anchor.from, n.anchor.to) : null;
};

describe("project", () => {
	it("removes Markdown and maps back to the source", () => {
		const p = project(ARTICLE);
		expect(p.text).toContain("Deep work is the ability to focus without distraction on a");
		expect(p.text).toContain("master complicated information and produce");
		expect(p.text).toContain("Used in Dijkstra's algorithm and heapsort");
		expect(p.text).not.toContain("tags");
		const i = p.text.indexOf("complicated");
		expect(ARTICLE.slice(p.src[i], p.src[i] + 11)).toBe("complicated");
	});

	it("keeps paragraph breaks when asked", () => {
		const doc = "One two.\n\nThree four.";
		expect(project(doc, 0, doc.length, true).text).toBe("One two.\n\nThree four.");
		expect(project(doc).text).toBe("One two. Three four.");
	});
});

describe("notes section", () => {
	it("is created at the end of the file and reads back", () => {
		const out = add(ARTICLE, "the ability to focus", "Why a skill and not a trait?");
		expect(out.endsWith(
			`and heapsort\n\n${MARKER}\n---\n\n## Notes\n\n> the ability to focus\n\nWhy a skill and not a trait?\n`,
		)).toBe(true);
		const m = buildModel(out);
		expect(m.notes).toHaveLength(1);
		expect(m.notes[0].text).toBe("Why a skill and not a trait?");
		expect(m.notes[0].question).toBe(true);
		expect(passageOf(out, m.notes[0].label)).toBe("the ability to focus");
	});

	it("keeps the article text untouched", () => {
		const out = add(ARTICLE, "the ability to focus", "n");
		expect(out.startsWith(ARTICLE)).toBe(true);
	});

	it("keeps entries in passage order", () => {
		let doc = add(ARTICLE, "heapsort", "last");
		doc = add(doc, "Deep work is", "first");
		doc = add(doc, "a skill", "middle");
		expect(buildModel(doc).notes.map((n) => [n.index, n.text])).toEqual([
			[1, "first"],
			[2, "middle"],
			[3, "last"],
		]);
		const s = parseSection(doc)!;
		expect(s.entries.map((e) => e.body)).toEqual(["first", "middle", "last"]);
	});

	it("round-trips multi-line notes and escapes quote lines in the body", () => {
		const body = "First line\n\n> not a new entry\n- a list";
		const out = add(ARTICLE, "heapsort", body);
		expect(buildModel(out).notes[0].text).toBe(body);
	});
});

describe("passages without restrictions", () => {
	it("crosses paragraphs", () => {
		const sel = "demanding task.\n\nIt's a skill";
		const out = add(ARTICLE, sel, "n");
		expect(out).toContain("> demanding task.\n>\n> It's a skill");
		expect(passageOf(out, buildModel(out).notes[0].label)).toBe("demanding task.\n\nIt's a skill");
	});

	it("overlaps and nests freely", () => {
		let doc = add(ARTICLE, "focus **without distraction** on a cognitively", "a");
		doc = add(doc, "distraction** on a cognitively demanding task", "b");
		doc = add(doc, "without", "c");
		const m = buildModel(doc);
		expect(m.notes.map((n) => n.text)).toEqual(["a", "c", "b"]);
		expect(m.notes.every((n) => n.anchor)).toBe(true);
		expect(noteAt(m, doc.indexOf("without") + 2)?.text).toBe("c");
	});

	it("starts and ends inside links and formatting", () => {
		const out = add(ARTICLE, "information](https://x.y) and produce", "n");
		expect(out).toContain("> information and produce");
		const n = buildModel(out).notes[0];
		expect(n.anchor).not.toBeNull();
	});

	it("tells repeated phrases apart with context", () => {
		const doc = "The cat sat. A dog ran. The cat slept.\n";
		const out = add(doc, "The cat", "second", 1);
		expect(out).toMatch(/> The cat <!-- prefix: ".*", suffix: ".*" -->/);
		const n = buildModel(out).notes[0];
		expect(n.anchor!.from).toBe(doc.lastIndexOf("The cat"));
	});
});

describe("robust anchoring", () => {
	it("survives edits elsewhere in the file (e.g. in another editor)", () => {
		const out = add(ARTICLE, "the ability to focus", "n");
		const edited = out.replace("# Deep Work\n", "# Deep Work\n\nA new intro paragraph.\n");
		expect(passageOf(edited, buildModel(edited).notes[0].label)).toBe("the ability to focus");
	});

	it("finds a passage whose middle was reworded", () => {
		const out = add(ARTICLE, "allows you to quickly master [complicated information", "n");
		const edited = out.replace("allows you to quickly master", "allows you to rapidly master");
		const n = buildModel(edited).notes[0];
		expect(n.anchor).not.toBeNull();
		expect(n.stale).toBe(true);
		expect(edited.slice(n.anchor!.from, n.anchor!.to)).toContain("rapidly master");
	});

	it("marks a note unattached when its passage is gone, without losing it", () => {
		const out = add(ARTICLE, "and heapsort", "n");
		const edited = out.replace("- Used in [[Dijkstra|Dijkstra's algorithm]] and heapsort\n", "");
		const n = buildModel(edited).notes[0];
		expect(n.anchor).toBeNull();
		expect(n.text).toBe("n");
	});

	it("prefers the occurrence nearest the previous position", () => {
		const p = project("aaa note bbb note ccc");
		const r = anchorQuote(p, "note", { hint: { from: 13, to: 17 } })!;
		expect(r.range.from).toBe(13);
	});
});

describe("edits", () => {
	const two = add(add(ARTICLE, "Deep work is", "first"), "heapsort", "second");

	it("updates a note", () => {
		const m = buildModel(two);
		const out = applyChanges(two, setBody(m.notes[0], "changed\nover two lines"));
		expect(buildModel(out).notes.map((n) => n.text)).toEqual(["changed\nover two lines", "second"]);
	});

	it("removes a note, then the section with the last one", () => {
		let m = buildModel(two);
		const one = applyChanges(two, removeEntry(two, m, m.notes[0]));
		expect(buildModel(one).notes.map((n) => n.text)).toEqual(["second"]);
		m = buildModel(one);
		const none = applyChanges(one, removeEntry(one, m, m.notes[0]));
		expect(none).toBe(ARTICLE);
	});

	it("re-attaches a note to a new passage", () => {
		const m = buildModel(two);
		const i = two.indexOf("cognitively");
		const out = applyChanges(two, setQuote(two, m, m.notes[0], { from: i, to: i + "cognitively".length })!);
		expect(buildModel(out).notes.find((n) => n.text === "first")!.passage).toBe("cognitively");
	});
});
