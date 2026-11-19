import { Extension } from '@codemirror/state';
import { Plugin } from 'obsidian';
import { registerCommands } from './commands';
import { NotesPanel, PANEL_VIEW } from './panel';
import { marginaliaEditor } from './editor';
import { ReadingNotes } from './reading';
import { highlights } from './render/highlights';
import { DEFAULT_SETTINGS, MarginaliaSettings, MarginaliaSettingTab } from './settings';

export default class MarginaliaPlugin extends Plugin {
	settings!: MarginaliaSettings;
	reading = new ReadingNotes(this);
	/** Registered once; refilled and re-applied when settings change. */
	private editorExtensions: Extension[] = [];

	async onload() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<MarginaliaSettings>);
		this.addSettingTab(new MarginaliaSettingTab(this.app, this));
		this.registerEditorExtension(this.editorExtensions);
		this.applySettings(false);
		this.reading.register();
		this.registerView(PANEL_VIEW, (leaf) => new NotesPanel(leaf));
		registerCommands(this);
	}

	onunload() {
		this.reading.unload();
		highlights.reset();
	}

	/** Hand the current settings to every open editor and Reading view. */
	applySettings(changed = true) {
		this.editorExtensions.length = 0;
		this.editorExtensions.push(marginaliaEditor({ ...this.settings }));
		this.app.workspace.updateOptions();
		if (changed) this.reading.refresh();
	}
}
