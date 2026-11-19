/** A span of the document, as offsets: [from, to). */
export interface Range {
	from: number;
	to: number;
}

/** A text edit, in the shape CodeMirror's ChangeSpec accepts. */
export interface Change {
	from: number;
	to: number;
	insert: string;
}
