import { Extension } from '@codemirror/state';
import { Plugin } from 'obsidian';
import { registerCommands } from './commands';
import { marginaliaEditor } from './editor';
import { highlights } from './render/highlights';
import { DEFAULT_SETTINGS, MarginaliaSettings, MarginaliaSettingTab } from './settings';

export default class MarginaliaPlugin extends Plugin {
	settings!: MarginaliaSettings;
	/** Registered once; refilled and re-applied when settings change. */
	private editorExtensions: Extension[] = [];

	async onload() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<MarginaliaSettings>);
		this.addSettingTab(new MarginaliaSettingTab(this.app, this));
		this.registerEditorExtension(this.editorExtensions);
		this.applySettings();
		registerCommands(this);
	}

	onunload() {
		highlights.reset();
	}

	/** Hand the current settings to every open editor. */
	applySettings() {
		this.editorExtensions.length = 0;
		this.editorExtensions.push(marginaliaEditor({ ...this.settings }));
		this.app.workspace.updateOptions();
	}
}
