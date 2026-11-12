import catalogData from './models.json';
import type { WiroSettings } from './settings';
import type { MediaKind } from './vault/files';
import { parseModelSlug, parsePriceRows, type ModelPricing, type ModelSchema, type ParamDef, type ParamOption } from './wiro/schema';

/** The things the plugin makes with Wiro AI models, each with its own model setting. */
export type FeatureId = 'image' | 'edit' | 'upscale' | 'video' | 'speech' | 'music' | 'transcribe';

export interface Feature {
	id: FeatureId;
	/** The settings page and menu name, in sentence case. */
	name: string;
	/** Catalog categories for "Browse the catalog" (Tool/List). */
	categories: string[];
	/** What the model returns: a file kind, or text. */
	output: MediaKind | 'text';
	/** The file the model takes, if any. */
	input?: MediaKind;
	/** Whether the model takes a prompt or text. */
	takesText: boolean;
	/** The start of the file names: "Wiro image 20261111153012.png". */
	fileLabel: string;
	/** The progress title: "Generating an image". */
	verb: string;
	/** The commands that use this model, for the settings page. */
	commands: string;
}

export const FEATURES: Record<FeatureId, Feature> = {
	image: { id: 'image', name: 'Image generation', categories: ['text-to-image'], output: 'image', takesText: true, fileLabel: 'Wiro image', verb: 'Generating an image', commands: 'Generate image, Generate image from selection' },
	edit: { id: 'edit', name: 'Image editing', categories: ['image-editing'], output: 'image', input: 'image', takesText: true, fileLabel: 'Wiro edit', verb: 'Editing the image', commands: 'Edit image' },
	upscale: { id: 'upscale', name: 'Upscaling', categories: ['upscale'], output: 'image', input: 'image', takesText: false, fileLabel: 'Wiro upscale', verb: 'Upscaling the image', commands: 'Upscale image' },
	video: { id: 'video', name: 'Video', categories: ['text-to-video'], output: 'video', takesText: true, fileLabel: 'Wiro video', verb: 'Generating a video', commands: 'Generate video' },
	speech: { id: 'speech', name: 'Speech', categories: ['text-to-speech'], output: 'audio', takesText: true, fileLabel: 'Wiro speech', verb: 'Generating speech', commands: 'Generate speech, Read note aloud' },
	music: { id: 'music', name: 'Music', categories: ['text-to-music'], output: 'audio', takesText: true, fileLabel: 'Wiro music', verb: 'Generating music', commands: 'Generate music' },
	transcribe: { id: 'transcribe', name: 'Transcription', categories: ['speech-to-text'], output: 'text', input: 'audio', takesText: false, fileLabel: 'Wiro transcript', verb: 'Transcribing', commands: 'Transcribe audio' },
};

export const FEATURE_IDS = Object.keys(FEATURES) as FeatureId[];

/** A model offered in a settings dropdown, with its parameters from scripts/update-models.mjs. */
export interface CatalogModel {
	slug: string;
	name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptions(value: unknown): ParamOption[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const options: ParamOption[] = [];
	for (const option of value as unknown[]) {
		if (!isRecord(option) || typeof option.value !== 'string') continue;
		options.push({ value: option.value, label: typeof option.label === 'string' ? option.label : option.value });
	}
	return options.length > 0 ? options : undefined;
}

function readParams(value: unknown): ParamDef[] {
	const params: ParamDef[] = [];
	for (const param of Array.isArray(value) ? (value as unknown[]) : []) {
		if (!isRecord(param) || typeof param.id !== 'string' || typeof param.type !== 'string') continue;
		params.push({
			id: param.id,
			type: param.type,
			label: typeof param.label === 'string' ? param.label : param.id,
			required: param.required === true,
			advanced: param.advanced === true,
			defaultValue: typeof param.defaultValue === 'string' ? param.defaultValue : '',
			options: readOptions(param.options),
		});
	}
	return params;
}

function readPricing(value: unknown): ModelPricing {
	const record = isRecord(value) ? value : {};
	const pricing: ModelPricing = { rows: parsePriceRows(record.rows) };
	if (typeof record.estimatedUsd === 'number') pricing.estimatedUsd = record.estimatedUsd;
	return pricing;
}

const data: unknown = catalogData;
const root = isRecord(data) ? data : {};
const featureLists = isRecord(root.features) ? root.features : {};
const modelRows = isRecord(root.models) ? root.models : {};

const MODELS = new Map<string, ModelSchema>();
for (const [slug, row] of Object.entries(modelRows)) {
	if (!isRecord(row)) continue;
	MODELS.set(slug, { slug, params: readParams(row.params), pricing: readPricing(row.pricing) });
}

const LISTS = new Map<FeatureId, CatalogModel[]>();
for (const id of FEATURE_IDS) {
	const list = Array.isArray(featureLists[id]) ? (featureLists[id] as unknown[]) : [];
	const models: CatalogModel[] = [];
	for (const entry of list) {
		if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') models.push({ slug: entry[0], name: entry[1] });
	}
	LISTS.set(id, models);
}

/** The built-in models of a feature, the first one being its default. */
export function catalogModels(feature: FeatureId): CatalogModel[] {
	return LISTS.get(feature) ?? [];
}

export function defaultModel(feature: FeatureId): string {
	return catalogModels(feature)[0]?.slug ?? '';
}

/** The bundled parameters and prices of a built-in model, used until the live ones load. */
export function bundledSchema(slug: string): ModelSchema | null {
	const schema = MODELS.get(slug);
	return schema ? { ...schema, params: [...schema.params] } : null;
}

/** A readable name for a model: its built-in name, else its slug. */
export function modelName(slug: string): string {
	for (const list of LISTS.values()) {
		const model = list.find((entry) => entry.slug === slug);
		if (model) return model.name;
	}
	return slug;
}

export interface SelectedModel {
	/** The `owner/project` slug, or null when the setting holds no valid slug. */
	slug: string | null;
	/** A name to show the user. */
	name: string;
}

/** The model the settings pick for a feature. */
export function selectedModel(settings: WiroSettings, feature: FeatureId): SelectedModel {
	const slug = parseModelSlug(settings.features[feature].model);
	return slug ? { slug, name: modelName(slug) } : { slug: null, name: 'no model' };
}
