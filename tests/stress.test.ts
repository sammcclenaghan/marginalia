import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
	addEntry,
	applyChanges,
	buildModel,
	MARKER,
	norm,
	parseSection,
	project,
	Range,
	removeEntry,
	setBody,
	snapToWords,
	withLf,
} from "../src/format";

const DOC = readFileSync(new URL("./fixtures/kitchen-sink.md", import.meta.url), "utf8");

/** Deterministic PRNG so failures reproduce. */
function rng(seed: number) {
	return () => {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		return seed / 2 ** 32;
	};
}

function at(doc: string, text: string, nth = 0): Range {
	let i = -1;
	for (let k = 0; k <= nth; k++) i = doc.indexOf(text, i + 1);
	if (i === -1) throw new Error(`not in doc: ${text}`);
	return { from: i, to: i + text.length };
}

function add(doc: string, range: Range, body = "note") {
	const changes = addEntry(doc, buildModel(doc), range, body);
	if (!changes) throw new Error(`could not add note on ${JSON.stringify(doc.slice(range.from, range.to))}`);
	return applyChanges(doc, changes);
}

/** The words of a passage as they appear on screen. */
const words = (doc: string, r: Range) => norm(project(doc, r.from, r.to).text);

const article = (doc: string) => {
	const s = parseSection(doc);
	return s ? doc.slice(0, s.from) : doc;
};

// Passages in every construct of the kitchen sink.
const TARGETS: [string, string][] = [
	["bold", "**bold text**"],
	["inside bold", "bold"],
	["italic + both", "*italic text*, ***both at once***"],
	["strikethrough", "~~struck out~~"],
	["plain highlight", "==a plain highlight=="],
	["inside highlight", "plain"],
	["inline code", "`inline code`"],
	["inside inline code", "inline code"],
	["markdown link", "[markdown link](https://example.com/path?q=1)"],
	["link text only", "markdown link"],
	["half a link", "link](https://example.com/path?q=1) plus a"],
	["wikilink alias", "[[Wikilink target|wikilink alias]]"],
	["bare wikilink", "a bare [[Wikilink target]]"],
	["bullet", "First bullet item with some words"],
	["across bullets", "some words\n- Second bullet"],
	["nested bullet", "Nested bullet under the second"],
	["ordered", "Ordered two with **emphasis**"],
	["task", "An unchecked task item"],
	["blockquote", "plain blockquote line"],
	["across quote lines", "little while.\n> Its second line"],
	["callout title", "Callout title here"],
	["callout body", "body of the callout"],
	["table cell", "beta cell"],
	["across table cells", "alpha cell | beta cell"],
	["inline math sentence", "Euler's identity $e^{i\\pi} + 1 = 0$ sits inline"],
	["after display math", "The display formula above"],
	["code block line", "return n if n < 2"],
	["after code", "Text right after the code block."],
	["external image line", "an external image here"],
	["footnote sentence", "A sentence with an ordinary footnote.[^cite] And an inline"],
	["comment line", "A comment %%hidden from readers%% sits"],
	["html span", "some red HTML text"],
	["html block", "A raw HTML block with words inside."],
	["emoji + accents", "Emoji 🎉 and accents — café, naïve, Zürich"],
	["cjk", "漢字かな交じり文"],
	["tag", "#tag-in-text and a final line"],
	["after hr", "Last paragraph after a horizontal rule."],
	["across sections", "the code block.\n\n## Media and embeds"],
	["heading", "Kitchen sink"],
];

describe("every construct", () => {
	for (const [name, text] of TARGETS) {
		it(name, () => {
			const r = at(DOC, text, name === "heading" ? 1 : 0);
			const out = add(DOC, r);
			expect(article(out)).toBe(DOC.replace(/\s+$/, "")); // the article itself is untouched
			const m = buildModel(out);
			expect(m.notes).toHaveLength(1);
			const a = m.notes[0].anchor!;
			expect(a, "anchored").not.toBeNull();
			expect(a.from).toBeGreaterThanOrEqual(r.from);
			expect(a.to).toBeLessThanOrEqual(r.to);
			expect(words(out, a)).toBe(words(DOC, r));
		});
	}

	it("all of them in one file, each on its own passage", () => {
		let doc = DOC;
		const ranges: [string, string][] = [];
		for (const [name, text] of TARGETS) {
			const r = at(doc, text, name === "heading" ? 1 : 0);
			ranges.push([name, words(doc, r)]);
			doc = add(doc, r, `note: ${name}`);
		}
		const m = buildModel(doc);
		expect(m.notes).toHaveLength(TARGETS.length);
		for (const [name, w] of ranges) {
			const n = m.notes.find((x) => x.text === `note: ${name}`)!;
			expect(n.anchor, name).not.toBeNull();
			expect(words(doc, n.anchor!), name).toBe(w);
		}
		expect(article(doc)).toBe(DOC.replace(/\s+$/, ""));
	});

	it("tells the second of two identical sentences apart", () => {
		const second = at(DOC, "The cat sat on the mat", 1);
		const out = add(DOC, second, "the second one");
		expect(out).toMatch(/> The cat sat on the mat <!-- .*suffix: "again/);
		expect(buildModel(out).notes[0].anchor!.from).toBe(second.from);
	});

	it("ignores selections inside frontmatter", () => {
		const r = at(DOC, "Stress test");
		const changes = addEntry(DOC, buildModel(DOC), r, "x");
		// Frontmatter isn't part of the readable article; nothing to quote.
		expect(changes).toBeNull();
	});
});

describe("fuzz", () => {
	const lines = DOC.split("\n");
	const bodyStart = DOC.indexOf("# Kitchen sink");
	const randomRange = (rand: () => number): Range => {
		let from = bodyStart + Math.floor(rand() * (DOC.length - bodyStart - 40));
		let to = from + 3 + Math.floor(rand() * 120);
		const r = snapToWords(DOC, from, Math.min(to, DOC.length));
		return r;
	};

	it("anchors 300 random selections exactly", () => {
		const rand = rng(7);
		let tried = 0;
		for (let i = 0; i < 300; i++) {
			const r = randomRange(rand);
			if (!/[\p{L}\p{N}]/u.test(project(DOC, r.from, r.to).text)) continue;
			const changes = addEntry(DOC, buildModel(DOC), r, "n");
			if (!changes) continue; // e.g. only syntax selected
			tried++;
			const out = applyChanges(DOC, changes);
			const n = buildModel(out).notes[0];
			expect(n.anchor, JSON.stringify(DOC.slice(r.from, r.to))).not.toBeNull();
			expect(words(out, n.anchor!), JSON.stringify(DOC.slice(r.from, r.to))).toBe(words(DOC, r));
		}
		expect(tried).toBeGreaterThan(200);
		expect(lines.length).toBeGreaterThan(50);
	});

	it("keeps 40 overlapping notes attached through random edits elsewhere", () => {
		const rand = rng(42);
		let doc = DOC;
		for (let i = 0; i < 40; i++) {
			const r = randomRange(rand);
			if (!/[\p{L}\p{N}]/u.test(project(doc, r.from, r.to).text)) continue;
			const changes = addEntry(doc, buildModel(doc), r, `n${i}`);
			if (changes) doc = applyChanges(doc, changes);
		}
		const before = buildModel(doc);
		const expected = new Map(before.notes.map((n) => [n.text, words(doc, n.anchor!)]));
		expect(before.notes.length).toBeGreaterThan(30);

		// Insert sentences between paragraphs (as an edit in another editor would).
		let edited = doc;
		const sectionStart = parseSection(edited)!.from;
		const gaps: number[] = [];
		const inside = (i: number) => before.notes.some((n) => n.anchor!.from < i && n.anchor!.to > i);
		for (let i = edited.indexOf("\n\n"); i !== -1 && i < sectionStart; i = edited.indexOf("\n\n", i + 1)) {
			if (!inside(i)) gaps.push(i);
		}
		for (const g of gaps.reverse().filter(() => rand() < 0.5)) {
			edited = edited.slice(0, g) + "\n\nAn inserted paragraph from another editor." + edited.slice(g);
		}
		const after = buildModel(edited);
		for (const n of after.notes) {
			expect(n.anchor, n.text).not.toBeNull();
			expect(words(edited, n.anchor!), n.text).toBe(expected.get(n.text));
		}
	});

	it("follows a passage that had a paragraph inserted inside it", () => {
		const out = add(DOC, at(DOC, "the code block.\n\n## Media and embeds"), "spans");
		const edited = out.replace("the code block.\n\n## Media", "the code block.\n\nAn inserted paragraph.\n\n## Media");
		const n = buildModel(edited).notes[0];
		expect(n.anchor).not.toBeNull();
		expect(n.stale).toBe(true); // found loosely; its quote will be refreshed
		expect(words(edited, n.anchor!)).toBe("the code block. An inserted paragraph. Media and embeds");
	});

	it("removing every note in random order restores the original file", () => {
		const rand = rng(99);
		let doc = DOC;
		for (const [name, text] of TARGETS.slice(0, 20)) doc = add(doc, at(doc, text, name === "heading" ? 1 : 0), name);
		while (buildModel(doc).notes.length) {
			const m = buildModel(doc);
			const n = m.notes[Math.floor(rand() * m.notes.length)];
			doc = applyChanges(doc, removeEntry(doc, m, n));
		}
		expect(doc).toBe(DOC);
	});
});

describe("note bodies", () => {
	const bodies = [
		"Plain.",
		"Multi\nline\n\nwith a blank line",
		"> looks like a quote\n> on two lines",
		"```js\nconst x = 1;\n```",
		"A comment <!-- like this --> inside",
		`Mentions the marker ${MARKER} inline`,
		"- a\n- list\n  - nested",
		"Ends with a question?",
		"Unicode 🎉 漢字 and $math$",
		"Trailing spaces   \nand tabs\t",
	];
	for (const body of bodies) {
		it(JSON.stringify(body).slice(0, 40), () => {
			const out = add(DOC, at(DOC, "beta cell"), body);
			const n = buildModel(out).notes[0];
			expect(n.text).toBe(body.trim());
			expect(n.anchor).not.toBeNull();
			// Editing it back and forth is stable.
			const again = applyChanges(out, setBody(n, body));
			expect(again).toBe(out);
		});
	}
});

describe("hand-written and odd sections", () => {
	it("reads a minimal hand-written section", () => {
		const doc = DOC + `\n${MARKER}\n> beta cell\n\nWritten by hand.\n`;
		const m = buildModel(doc);
		expect(m.notes[0].text).toBe("Written by hand.");
		expect(words(doc, m.notes[0].anchor!)).toBe("beta cell");
	});

	it("tolerates a note body written right under the quote", () => {
		const doc = DOC + `\n${MARKER}\n## Notes\n\n> beta cell\nNo blank line.\n\n> gamma cell\n\nSecond.\n`;
		expect(buildModel(doc).notes.map((n) => n.text)).toEqual(["No blank line.", "Second."]);
	});

	it("does not mistake an ordinary '## Notes' heading for the section", () => {
		const doc = "Article.\n\n## Notes\n\n> a quote of my own\n\nMy own text.\n";
		expect(parseSection(doc)).toBeNull();
		expect(buildModel(doc).notes).toEqual([]);
	});

	it("keeps unattached notes when their passage is deleted, then re-finds them on undo", () => {
		const out = add(DOC, at(DOC, "zeta cell"), "z");
		const gone = out.replace("| delta cell | epsilon    | zeta cell    |\n", "");
		expect(buildModel(gone).notes[0].anchor).toBeNull();
		expect(buildModel(out).notes[0].anchor).not.toBeNull();
	});

	it("preserves Windows line endings", () => {
		const crlf = DOC.replace(/\n/g, "\r\n");
		const out = withLf(crlf, (doc) => add(doc, at(doc, "beta cell"), "n"));
		expect(out.includes("\r\n")).toBe(true);
		expect(out.replace(/\r\n/g, "").includes("\n")).toBe(false);
		expect(buildModel(out.replace(/\r\n/g, "\n")).notes[0].anchor).not.toBeNull();
	});
});

describe("performance", () => {
	it("parses and anchors 100 notes in a large file quickly", () => {
		let big = "";
		for (let i = 0; i < 400; i++) big += DOC.slice(DOC.indexOf("# Kitchen")).replace(/Kitchen sink/g, `Section ${i}`) + "\n";
		const rand = rng(3);
		let doc = big;
		for (let i = 0; i < 100; i++) {
			const from = Math.floor(rand() * (big.length - 200));
			const r = snapToWords(doc, from, from + 40);
			const changes = addEntry(doc, buildModel(doc), r, `n${i}`);
			if (changes) doc = applyChanges(doc, changes);
		}
		const t0 = performance.now();
		const m = buildModel(doc);
		const ms = performance.now() - t0;
		expect(doc.length).toBeGreaterThan(800_000);
		expect(m.notes.length).toBeGreaterThan(90);
		expect(m.notes.filter((n) => n.anchor).length).toBe(m.notes.length);
		expect(ms).toBeLessThan(1000);
	});
});

describe("formulas and tables", () => {
	it("annotates a display formula on its own, written as its source", () => {
		const r = at(DOC, "\\int_0^1 x^2");
		const out = add(DOC, r, "integral");
		expect(out).toMatch(/> \$\$ \\int_0\^1 x\^2 \\, dx = \\frac\{1\}\{3\} \$\$( <!--.*-->)?\n\nintegral/);
		const a = buildModel(out).notes[0].anchor!;
		expect(out.slice(a.from, a.to)).toBe("$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$");
	});

	it("annotates an inline formula on its own", () => {
		const out = add(DOC, at(DOC, "$e^{i\\pi} + 1 = 0$"), "euler");
		// Formulas all look alike when matching, so context is recorded.
		expect(out).toMatch(/> \$e\^\{i\\pi\} \+ 1 = 0\$ <!-- prefix: "identity", suffix: "sits inline" -->\n\neuler/);
		const n = buildModel(out).notes[0];
		expect(out.slice(n.anchor!.from, n.anchor!.to)).toBe("$e^{i\\pi} + 1 = 0$");
		expect(n.passage).toBe("$e^{i\\pi} + 1 = 0$");
	});

	it("quotes a table row without its cell dividers", () => {
		const out = add(DOC, at(DOC, "alpha cell | beta cell"), "row");
		expect(out).toContain("> alpha cell beta cell\n\nrow");
		expect(buildModel(out).notes[0].anchor).not.toBeNull();
	});

	it("treats dollar amounts as text, not formulas", () => {
		const doc = "It costs $5 and $10 to enter.\n";
		const out = add(doc, at(doc, "$5 and $10"), "prices");
		expect(out).toContain("> \\$5 and \\$10\n\nprices");
		expect(buildModel(out).notes[0].anchor).toEqual(at(doc, "$5 and $10"));
	});
});
