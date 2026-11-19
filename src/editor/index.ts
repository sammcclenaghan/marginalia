/** Marginalia in the editor (Live Preview and Source mode). */
import { Extension, Prec } from '@codemirror/state';
import type { MarginaliaSettings } from '../settings';
import { decorationsField, passageStyle } from './decorations';
import { marginPlugin } from './margin';
import { requotePlugin } from './requote';
import { activeField, draftField, hoverField, notesField, settingsFacet } from './state';

/** Everything except the settings stays the same across reconfigures, so editors keep their state. */
const core: Extension = [
	notesField,
	draftField,
	activeField,
	hoverField,
	Prec.high(decorationsField),
	passageStyle,
	marginPlugin,
	requotePlugin,
];

export function marginaliaEditor(settings: MarginaliaSettings): Extension {
	return [settingsFacet.of(settings), core];
}
