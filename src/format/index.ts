/** Marginalia's file format: the notes section, and finding each note's passage. */
export type { Change, Range } from './types';
export { LINE_PREFIX, MATH, norm, occurrences, project, sourceRange } from './project';
export type { Projection } from './project';
export { formatBody, formatQuote, MARKER, parseSection } from './section';
export type { Entry, Section } from './section';
export { anchorQuote, buildModel, isQuestion, noteAt } from './anchor';
export type { BuildOptions, Model, Note } from './anchor';
export { addEntry, applyChanges, quoteFor, removeEntry, setBody, setQuote, snapToWords, withLf } from './edits';
