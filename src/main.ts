import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, MarginaliaSettings, MarginaliaSettingTab } from './settings';

export default class MarginaliaPlugin extends Plugin {
	settings!: MarginaliaSettings;

	async onload() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<MarginaliaSettings>,
		);
		this.addSettingTab(new MarginaliaSettingTab(this.app, this));
	}
}
