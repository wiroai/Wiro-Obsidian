import { FEATURE_IDS, defaultModel, type FeatureId } from './catalog';
import type { MediaKind } from './vault/files';

export interface FeatureSettings {
	/** The model's `owner/project` slug. */
	model: string;
	/** A JSON object sent with every run of this feature. */
	extraParams: string;
}

export type TranscriptStyle = 'callout' | 'quote' | 'paragraph';

/** A run this plugin saved files for, kept for the history view. */
export interface HistoryEntry {
	at: number;
	label: string;
	model: string;
	costUsd?: number;
	files: string[];
	note?: string;
	taskId?: string;
}

export const HISTORY_LIMIT = 50;

export interface WiroSettings {
	/** ID of the secret in Obsidian's keychain that holds the API key. */
	apiKeySecretId: string;
	/** ID of the secret that holds the API secret, for signature-based projects. */
	apiSecretSecretId: string;
	features: Record<FeatureId, FeatureSettings>;
	/** Chosen options per model slug, such as {"google/nano-banana-2-1": {"aspectRatio": "16:9"}}. */
	modelOptions: Record<string, Record<string, string>>;
	imageFolder: string;
	videoFolder: string;
	audioFolder: string;
	speechPlainText: boolean;
	transcriptStyle: TranscriptStyle;
	/** The LLM gateway model for the text commands. */
	textModel: string;
	translateLanguage: string;
	/** Show the price and ask before commands that would otherwise run right away. */
	confirmRuns: boolean;
	editorMenu: boolean;
	history: HistoryEntry[];
}

export const DEFAULT_TEXT_MODEL = 'google/gemini-3-flash';

export function defaultSettings(): WiroSettings {
	const features = {} as Record<FeatureId, FeatureSettings>;
	for (const id of FEATURE_IDS) features[id] = { model: defaultModel(id), extraParams: '' };
	return {
		apiKeySecretId: '',
		apiSecretSecretId: '',
		features,
		modelOptions: {},
		imageFolder: '',
		videoFolder: '',
		audioFolder: '',
		speechPlainText: true,
		transcriptStyle: 'callout',
		textModel: DEFAULT_TEXT_MODEL,
		translateLanguage: 'English',
		confirmRuns: true,
		editorMenu: true,
		history: [],
	};
}

export function folderFor(settings: WiroSettings, kind: MediaKind): string {
	return kind === 'image' ? settings.imageFolder : kind === 'video' ? settings.videoFolder : settings.audioFolder;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

/** Reads saved settings, keeping only values of the right type, and moves 1.0 settings to their new places. */
export function normalizeSettings(data: unknown): WiroSettings {
	const settings = defaultSettings();
	if (!isRecord(data)) return settings;

	for (const key of ['apiKeySecretId', 'apiSecretSecretId', 'imageFolder', 'videoFolder', 'audioFolder', 'textModel', 'translateLanguage'] as const) {
		const value = str(data[key]);
		if (value !== undefined) settings[key] = value;
	}
	for (const key of ['speechPlainText', 'confirmRuns', 'editorMenu'] as const) {
		if (typeof data[key] === 'boolean') settings[key] = data[key];
	}
	if (data.transcriptStyle === 'callout' || data.transcriptStyle === 'quote' || data.transcriptStyle === 'paragraph') {
		settings.transcriptStyle = data.transcriptStyle;
	}

	// 1.0 kept the image and speech models in flat keys, with "custom" for other models.
	const legacy = (feature: FeatureId, prefix: 'image' | 'speech') => {
		const model = str(data[`${prefix}Model`]);
		const custom = str(data[`${prefix}CustomModel`]);
		const chosen = model === 'custom' ? custom : model;
		if (chosen) settings.features[feature].model = chosen;
		const extra = str(data[`${prefix}ExtraParams`]);
		if (extra !== undefined) settings.features[feature].extraParams = extra;
	};
	legacy('image', 'image');
	legacy('speech', 'speech');
	const speechFolder = str(data.speechFolder);
	if (speechFolder !== undefined && str(data.audioFolder) === undefined) settings.audioFolder = speechFolder;

	if (isRecord(data.features)) {
		for (const id of FEATURE_IDS) {
			const entry = data.features[id];
			if (!isRecord(entry)) continue;
			const model = str(entry.model);
			if (model) settings.features[id].model = model;
			const extra = str(entry.extraParams);
			if (extra !== undefined) settings.features[id].extraParams = extra;
		}
	}

	if (isRecord(data.modelOptions)) {
		for (const [slug, options] of Object.entries(data.modelOptions)) {
			if (!isRecord(options)) continue;
			const clean: Record<string, string> = {};
			for (const [param, value] of Object.entries(options)) {
				if (typeof value === 'string') clean[param] = value;
			}
			settings.modelOptions[slug] = clean;
		}
	}

	if (Array.isArray(data.history)) {
		for (const entry of data.history as unknown[]) {
			if (!isRecord(entry) || typeof entry.at !== 'number' || typeof entry.label !== 'string' || typeof entry.model !== 'string') continue;
			const item: HistoryEntry = {
				at: entry.at,
				label: entry.label,
				model: entry.model,
				files: Array.isArray(entry.files) ? (entry.files as unknown[]).filter((file): file is string => typeof file === 'string') : [],
			};
			if (typeof entry.costUsd === 'number') item.costUsd = entry.costUsd;
			if (typeof entry.note === 'string') item.note = entry.note;
			if (typeof entry.taskId === 'string') item.taskId = entry.taskId;
			settings.history.push(item);
		}
		settings.history = settings.history.slice(0, HISTORY_LIMIT);
	}
	return settings;
}
