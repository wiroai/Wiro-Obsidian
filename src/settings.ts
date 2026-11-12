import type { MediaKind } from './vault/files';

/** Dropdown value for a model that is not in the built-in list. */
export const CUSTOM_MODEL = 'custom';

export interface WiroSettings {
	/** ID of the secret in Obsidian's secret storage that holds the API key. */
	apiKeySecretId: string;
	/** ID of the secret that holds the API secret, for signature-based projects. */
	apiSecretSecretId: string;
	imageModel: string;
	imageCustomModel: string;
	imageExtraParams: string;
	imageFolder: string;
	speechModel: string;
	speechCustomModel: string;
	speechExtraParams: string;
	speechFolder: string;
	speechPlainText: boolean;
	/** Chosen options per model slug, such as {"google/nano-banana-2-1": {"aspectRatio": "16:9"}}. */
	modelOptions: Record<string, Record<string, string>>;
}

export const DEFAULT_SETTINGS: WiroSettings = {
	apiKeySecretId: '',
	apiSecretSecretId: '',
	imageModel: 'google/nano-banana-2-1',
	imageCustomModel: '',
	imageExtraParams: '',
	imageFolder: '',
	speechModel: 'elevenlabs/eleven-v4',
	speechCustomModel: '',
	speechExtraParams: '',
	speechFolder: '',
	speechPlainText: true,
	modelOptions: {},
};

/** The settings keys that belong to one kind of media. */
export interface KindKeys {
	model: 'imageModel' | 'speechModel';
	customModel: 'imageCustomModel' | 'speechCustomModel';
	extraParams: 'imageExtraParams' | 'speechExtraParams';
	folder: 'imageFolder' | 'speechFolder';
}

export function kindKeys(kind: MediaKind): KindKeys {
	return kind === 'image'
		? { model: 'imageModel', customModel: 'imageCustomModel', extraParams: 'imageExtraParams', folder: 'imageFolder' }
		: { model: 'speechModel', customModel: 'speechCustomModel', extraParams: 'speechExtraParams', folder: 'speechFolder' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads saved settings, keeping only values of the right type. */
export function normalizeSettings(data: unknown): WiroSettings {
	const settings: WiroSettings = { ...DEFAULT_SETTINGS, modelOptions: {} };
	if (!isRecord(data)) return settings;
	const strings = [
		'apiKeySecretId',
		'apiSecretSecretId',
		'imageModel',
		'imageCustomModel',
		'imageExtraParams',
		'imageFolder',
		'speechModel',
		'speechCustomModel',
		'speechExtraParams',
		'speechFolder',
	] as const;
	for (const key of strings) {
		const value = data[key];
		if (typeof value === 'string') settings[key] = value;
	}
	if (typeof data.speechPlainText === 'boolean') settings.speechPlainText = data.speechPlainText;
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
	return settings;
}
