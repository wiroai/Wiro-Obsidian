import { Plugin } from 'obsidian';
import { registerCommands } from './commands';
import { loadDesktopStreamTransport } from './desktop-stream';
import type { MediaHost } from './features/media';
import type { TextHost } from './features/text';
import { obsidianHttp } from './obsidian-http';
import { SchemaCache } from './schema-cache';
import { HISTORY_LIMIT, normalizeSettings, type HistoryEntry, type WiroSettings } from './settings';
import { WiroSettingTab } from './settings-tab';
import { HISTORY_VIEW, HistoryView } from './ui/history-view';
import type { Credentials } from './wiro/auth';
import { WiroClient } from './wiro/client';
import { GatewayClient, type GatewayModel, type StreamTransport } from './wiro/gateway';

export default class WiroPlugin extends Plugin implements MediaHost, TextHost {
	settings: WiroSettings = normalizeSettings(undefined);
	readonly http = obsidianHttp;
	readonly schemas = new SchemaCache(() => new WiroClient(this.http, null));
	private readonly jobs = new Set<AbortController>();
	/** Set once Node's https module has loaded on desktop; null on mobile. */
	private stream: StreamTransport | null = null;
	private models: Promise<GatewayModel[]> | null = null;
	private unloading = false;

	async onload(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		this.addSettingTab(new WiroSettingTab(this.app, this));
		this.registerView(HISTORY_VIEW, (leaf) => new HistoryView(leaf, this));
		registerCommands(this);
		void loadDesktopStreamTransport().then((transport) => {
			this.stream = transport;
		});
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

	/** The API key and secret from Obsidian's keychain, or null when no key is set. */
	credentials(): Credentials | null {
		const storage = this.app.secretStorage;
		const apiKey = this.settings.apiKeySecretId ? storage.getSecret(this.settings.apiKeySecretId)?.trim() : '';
		if (!apiKey) return null;
		const apiSecret = this.settings.apiSecretSecretId ? storage.getSecret(this.settings.apiSecretSecretId)?.trim() : '';
		return apiSecret ? { apiKey, apiSecret } : { apiKey };
	}

	client(credentials: Credentials): WiroClient {
		return new WiroClient(this.http, credentials);
	}

	gateway(credentials: Credentials): GatewayClient {
		return new GatewayClient(this.http, credentials, this.stream);
	}

	/** The LLM gateway's models, loaded once per session. */
	gatewayModels(): Promise<GatewayModel[]> {
		if (!this.models) {
			this.models = new GatewayClient(this.http, null, null).models().catch((error: unknown) => {
				this.models = null;
				throw error;
			});
		}
		return this.models;
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

	history(): HistoryEntry[] {
		return this.settings.history;
	}

	async addHistory(entry: HistoryEntry): Promise<void> {
		this.settings.history = [entry, ...this.settings.history].slice(0, HISTORY_LIMIT);
		await this.saveSettings();
		for (const leaf of this.app.workspace.getLeavesOfType(HISTORY_VIEW)) {
			if (leaf.view instanceof HistoryView) leaf.view.refresh();
		}
	}

	async openHistory(): Promise<void> {
		const leaf = await this.app.workspace.ensureSideLeaf(HISTORY_VIEW, 'right', { active: true, reveal: true });
		await this.app.workspace.revealLeaf(leaf);
	}
}
