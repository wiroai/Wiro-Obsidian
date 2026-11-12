import catalogData from './models.json';
import { CUSTOM_MODEL, kindKeys, type WiroSettings } from './settings';
import type { MediaKind } from './vault/files';
import { parseModelSlug, type ModelSchema, type ParamDef, type ParamOption } from './wiro/schema';

/** A model offered in the settings dropdown, with its parameters from scripts/update-models.mjs. */
export interface CatalogModel {
	slug: string;
	name: string;
	params: ParamDef[];
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

function readModels(value: unknown): CatalogModel[] {
	if (!Array.isArray(value)) return [];
	const models: CatalogModel[] = [];
	for (const entry of value as unknown[]) {
		if (!isRecord(entry) || typeof entry.slug !== 'string' || typeof entry.name !== 'string') continue;
		const params: ParamDef[] = [];
		for (const param of Array.isArray(entry.params) ? (entry.params as unknown[]) : []) {
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
		models.push({ slug: entry.slug, name: entry.name, params });
	}
	return models;
}

const data: unknown = catalogData;
const CATALOG: Record<MediaKind, CatalogModel[]> = {
	image: readModels(isRecord(data) ? data.image : undefined),
	speech: readModels(isRecord(data) ? data.speech : undefined),
};

export function catalogModels(kind: MediaKind): CatalogModel[] {
	return CATALOG[kind];
}

/** The bundled parameters of a listed model, used until the live ones load. */
export function bundledSchema(slug: string): ModelSchema | null {
	for (const models of Object.values(CATALOG)) {
		const model = models.find((entry) => entry.slug === slug);
		if (model) return { slug: model.slug, params: model.params };
	}
	return null;
}

export interface SelectedModel {
	/** The `owner/project` slug, or null when "Other model" has no valid slug yet. */
	slug: string | null;
	/** A name to show the user. */
	name: string;
}

/** The model the settings pick for one kind of media. */
export function selectedModel(settings: WiroSettings, kind: MediaKind): SelectedModel {
	const keys = kindKeys(kind);
	const choice = settings[keys.model];
	if (choice === CUSTOM_MODEL) {
		const slug = parseModelSlug(settings[keys.customModel]);
		return { slug, name: slug ?? 'another model' };
	}
	const listed = CATALOG[kind].find((model) => model.slug === choice);
	if (listed) return { slug: listed.slug, name: listed.name };
	// A slug saved by an older version, or one that left the list.
	const slug = parseModelSlug(choice);
	return { slug, name: slug ?? choice };
}
