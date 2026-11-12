import { Plugin } from 'obsidian';
import { registerCommands } from './commands';
import type { JobHost } from './jobs';
import { obsidianHttp } from './obsidian-http';
import { SchemaCache } from './schema-cache';
import { normalizeSettings, type WiroSettings } from './settings';
import { WiroSettingTab } from './settings-tab';
import type { Credentials } from './wiro/auth';
import { WiroClient } from './wiro/client';

export default class WiroPlugin extends Plugin implements JobHost {
	settings: WiroSettings = normalizeSettings(undefined);
	readonly http = obsidianHttp;
	readonly schemas = new SchemaCache(() => new WiroClient(this.http, null));
	private readonly jobs = new Set<AbortController>();
	private unloading = false;

	async onload(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		this.addSettingTab(new WiroSettingTab(this.app, this));
		registerCommands(this);
	}

	onunload(): void {
		// Running tasks are left to finish on Wiro AI; only the waiting stops.
		this.unloading = true;
		for (const job of this.jobs) job.abort();
		this.jobs.clear();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Reloads the settings when data.json changes on disk, for example through sync. */
	async onExternalSettingsChange(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
	}

	/** The API key and secret from Obsidian's secret storage, or null when no key is set. */
	credentials(): Credentials | null {
		const storage = this.app.secretStorage;
		const apiKey = this.settings.apiKeySecretId ? storage.getSecret(this.settings.apiKeySecretId)?.trim() : '';
		if (!apiKey) return null;
		const apiSecret = this.settings.apiSecretSecretId
			? storage.getSecret(this.settings.apiSecretSecretId)?.trim()
			: '';
		return apiSecret ? { apiKey, apiSecret } : { apiKey };
	}

	client(credentials: Credentials): WiroClient {
		return new WiroClient(this.http, credentials);
	}

	trackJob(controller: AbortController): () => void {
		this.jobs.add(controller);
		return () => {
			this.jobs.delete(controller);
		};
	}

	isUnloading(): boolean {
		return this.unloading;
	}
}
