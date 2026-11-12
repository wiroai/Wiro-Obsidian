/** One choice of a select parameter. */
export interface ParamOption {
	value: string;
	label: string;
}

/** One input parameter of a model, as Tool/Detail describes it. */
export interface ParamDef {
	id: string;
	type: string;
	label: string;
	required: boolean;
	advanced: boolean;
	defaultValue: string;
	options?: ParamOption[];
}

/** The parameters of one model, by its `owner/project` slug. */
export interface ModelSchema {
	slug: string;
	params: ParamDef[];
}

export type ParamValue = string | number | boolean;

const FILE_TYPES = new Set(['fileinput', 'multifileinput', 'multifileinputdrop', 'combinefileinput']);
const TEXT_TYPES = new Set(['textarea', 'text']);
const NUMBER_TYPES = new Set(['number', 'float', 'range']);

/** Select parameters that only change the response format, not the result. */
const HIDDEN_OPTIONS = new Set(['timestamps']);

/** Matches an `owner/project` slug, as in https://wiro.ai/models/owner/project */
const SLUG = /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/;

/**
 * Turns user input into a model slug. Accepts `owner/project` and full model
 * page URLs such as `https://wiro.ai/models/google/nano-banana-2-1`.
 * Returns null when the input is neither.
 */
export function parseModelSlug(input: string): string | null {
	let value = input.trim();
	const page = /^(?:https?:\/\/)?(?:www\.)?wiro\.ai\/models\/([^/?#\s]+\/[^/?#\s]+)/i.exec(value);
	if (page?.[1]) value = page[1];
	value = value.replace(/\/+$/, '');
	return SLUG.test(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	return '';
}

/**
 * Reads the parameters of a model from a Tool/Detail response
 * (https://wiro.ai/docs/models). Returns null when the response has no model.
 */
export function parseToolDetail(slug: string, data: unknown): ModelSchema | null {
	if (!isRecord(data) || !Array.isArray(data.tool)) return null;
	const tool: unknown = data.tool[0];
	if (!isRecord(tool)) return null;
	const params: ParamDef[] = [];
	const groups = Array.isArray(tool.parameters) ? (tool.parameters as unknown[]) : [];
	for (const group of groups) {
		if (!isRecord(group) || !Array.isArray(group.items)) continue;
		for (const item of group.items as unknown[]) {
			if (!isRecord(item)) continue;
			const id = asString(item.id);
			const type = asString(item.type);
			if (!id || !type) continue;
			const param: ParamDef = {
				id,
				type,
				label: asString(item.label) || id,
				required: item.required === true,
				advanced: item.advanced === true,
				// Text and file defaults are sample inputs, never settings.
				defaultValue: TEXT_TYPES.has(type) || FILE_TYPES.has(type) ? '' : asString(item.defaultvalue),
			};
			if (Array.isArray(item.options)) {
				const options: ParamOption[] = [];
				for (const option of item.options as unknown[]) {
					if (!isRecord(option) || option.value === undefined) continue;
					const value = asString(option.value);
					options.push({ value, label: asString(option.text) || value });
				}
				if (options.length > 0) param.options = options;
			}
			params.push(param);
		}
	}
	return { slug, params };
}

/** The parameter that takes the prompt or the text to speak. */
export function textParamId(schema: ModelSchema | null): string {
	if (!schema) return 'prompt';
	const prompt = schema.params.find((param) => param.id === 'prompt');
	if (prompt) return prompt.id;
	const text = schema.params.find((param) => TEXT_TYPES.has(param.type) && /text|prompt/i.test(param.id));
	return text?.id ?? 'prompt';
}

/**
 * Defaults for the required settings (selects, numbers, checkboxes), so a run
 * that leaves them out still validates. The Run API fills optional parameters
 * itself, but answers "Request parameter [x] required" for missing required
 * ones. Text, JSON and file parameters are never filled in.
 */
export function requiredDefaults(schema: ModelSchema): Record<string, ParamValue> {
	const result: Record<string, ParamValue> = {};
	for (const param of schema.params) {
		if (!param.required || param.defaultValue === '') continue;
		if (NUMBER_TYPES.has(param.type)) {
			const number = Number(param.defaultValue);
			if (Number.isFinite(number)) result[param.id] = number;
		} else if (param.type === 'select' || param.type === 'checkbox') {
			result[param.id] = param.defaultValue;
		}
	}
	return result;
}

/** The select parameters shown as options in the settings tab. */
export function optionParams(schema: ModelSchema): ParamDef[] {
	return schema.params.filter(
		(param) => param.type === 'select' && (param.options?.length ?? 0) > 0 && !HIDDEN_OPTIONS.has(param.id),
	);
}

/** The value a select option takes when the user has not picked one. */
export function defaultOption(param: ParamDef): string {
	const options = param.options ?? [];
	if (options.some((option) => option.value === param.defaultValue)) return param.defaultValue;
	return options[0]?.value ?? '';
}

/** A parameter label in sentence case: "Aspect Ratio" and "aspectRatio" become "Aspect ratio". */
export function sentenceCaseLabel(label: string): string {
	const words = label
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[_-]+/g, ' ')
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	return words
		.map((word, index) => {
			// Keep acronyms and units such as "TTS", "(K)" or "4K".
			if (word.length > 1 && word === word.toUpperCase()) return word;
			const lower = word.toLowerCase();
			return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
		})
		.join(' ');
}

/**
 * Builds the Run request body: required defaults, then the saved options
 * (only values the model still offers), then the extra parameters, then the
 * prompt or text.
 */
export function buildRunParams(
	schema: ModelSchema | null,
	text: string,
	options: Record<string, string>,
	extra: Record<string, unknown>,
): Record<string, unknown> {
	const params: Record<string, unknown> = schema ? { ...requiredDefaults(schema) } : {};
	if (schema) {
		for (const param of optionParams(schema)) {
			const value = options[param.id];
			if (value !== undefined && param.options?.some((option) => option.value === value)) {
				params[param.id] = value;
			}
		}
	}
	Object.assign(params, extra);
	params[textParamId(schema)] = text;
	return params;
}

/**
 * Parses the "Extra parameters" setting: a JSON object, or empty.
 * Throws an Error with a readable message when it is not valid.
 */
export function parseExtraParams(text: string): Record<string, unknown> {
	const trimmed = text.trim();
	if (!trimmed) return {};
	let value: unknown;
	try {
		value = JSON.parse(trimmed);
	} catch {
		throw new Error('Extra parameters must be valid JSON, for example {"seed": 42}.');
	}
	if (!isRecord(value)) {
		throw new Error('Extra parameters must be a JSON object, for example {"seed": 42}.');
	}
	return value;
}
