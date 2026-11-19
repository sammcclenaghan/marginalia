import { App, PluginSettingTab, SettingDefinitionItem } from 'obsidian';
import type MarginaliaPlugin from './main';

export type PassageStyle = 'underline' | 'highlight' | 'none';

export interface MarginaliaSettings {
	/** Width of the notes column, in pixels. */
	marginWidth: number;
	/** How annotated text looks. */
	passageStyle: PassageStyle;
	/** Hide the notes section at the end of the file in live preview. */
	hideSection: boolean;
	/** Show notes in the margin in reading view. */
	readingView: boolean;
}

export const DEFAULT_SETTINGS: MarginaliaSettings = {
	marginWidth: 260,
	passageStyle: 'underline',
	hideSection: true,
	readingView: true,
};

/** Declarative settings: Obsidian renders them and includes them in settings search. */
export class MarginaliaSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly marginalia: MarginaliaPlugin,
	) {
		super(app, marginalia);
	}

	/** Saved by Obsidian, then applied to open editors right away. */
	async setControlValue(key: string, value: unknown) {
		await super.setControlValue(key, value);
		this.marginalia.applySettings();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Margin width',
				desc: 'Width of the notes column. Panes too narrow for it show notes as popovers.',
				control: { type: 'slider', key: 'marginWidth', min: 180, max: 380, step: 10 },
			},
			{
				name: 'Passage style',
				desc: 'How annotated text looks. It always lights up when its note is in focus.',
				control: {
					type: 'dropdown',
					key: 'passageStyle',
					options: { underline: 'Faint underline', highlight: 'Highlight', none: 'Nothing' },
				},
			},
			{
				name: 'Hide the notes section while editing',
				desc: 'In live preview, hide the notes at the end of the file. Source mode always shows them.',
				control: { type: 'toggle', key: 'hideSection' },
			},
			{
				name: 'Notes in reading view',
				desc: 'Show notes in the margin in reading view.',
				control: { type: 'toggle', key: 'readingView' },
			},
		];
	}
}
