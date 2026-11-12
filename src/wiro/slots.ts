// Models in one category name their parameters differently (inputImage,
// inputImageHuman; duration, durationSeconds; ratio, aspectRatio). This module
// finds the common slots in a model's schema so a feature can fill them
// without knowing the model. Adapted from the parameter gateway of the Wiro AI
// browser extensions (Wiro-Extension-Core).

import { isFileParam, type ModelSchema, type ParamDef } from './schema';

export type FileKind = 'image' | 'video' | 'audio' | 'file';

export type SlotName = 'prompt' | 'negativePrompt' | 'duration' | 'resolution' | 'ratio' | 'count' | 'voice' | 'language';

export interface FileSlot {
	param: ParamDef;
	kind: FileKind;
}

export interface ModelSlots {
	files: FileSlot[];
	named: Partial<Record<SlotName, ParamDef>>;
	/** Parameters that are neither files nor named slots, in schema order. */
	rest: ParamDef[];
}

const SLOT_PATTERNS: [SlotName, RegExp][] = [
	['negativePrompt', /^(negative_?prompt|negative)$/i],
	['prompt', /^(prompt|text|script|lyrics|caption|instruction|instructions|query|question|message|inputtext|input_text)$/i],
	['duration', /^(duration|durationseconds|duration_seconds|length|seconds|videolength|video_length|videoduration)$/i],
	['resolution', /^(resolution|quality|size|imagesize|image_size|outputresolution|output_resolution|res)$/i],
	['ratio', /^(ratio|aspectratio|aspect_ratio|aspect)$/i],
	['count', /^(n|samples|numberofimages|number_of_images|numimages|num_images|numoutputs|num_outputs|count|batchsize)$/i],
	['voice', /^(voice|voiceid|voice_id|speaker|voicename|voice_name)$/i],
	['language', /^(language|languagecode|language_code|targetlanguage|target_language|lang)$/i],
];

/** The kind of file a file parameter takes, from its id, label and note. */
export function fileKind(param: ParamDef): FileKind {
	const text = `${param.id} ${param.label} ${param.placeholder ?? ''}`.toLowerCase();
	if (/video|clip|mp4|footage/.test(text)) return 'video';
	if (/audio|voice|speech|song|music|sound|mp3|wav|vocal/.test(text)) return 'audio';
	if (/image|photo|picture|face|portrait|frame|logo|mask|garment|cloth|human|person|product|reference|selfie|avatar|style/.test(text)) return 'image';
	return 'file';
}

export function slotsFor(schema: ModelSchema): ModelSlots {
	const params = schema.params;
	const files: FileSlot[] = [];
	const named: Partial<Record<SlotName, ParamDef>> = {};
	const used = new Set<string>();

	for (const param of params) {
		if (!isFileParam(param)) continue;
		files.push({ param, kind: fileKind(param) });
		used.add(param.id);
	}
	// A text field that only repeats a file field as a URL (inputImage + inputImageUrl)
	// is covered by the file field.
	for (const slot of files) {
		const twin = params.find((candidate) => candidate.id.toLowerCase() === `${slot.param.id}url`.toLowerCase());
		if (twin) used.add(twin.id);
		const multiple = params.find(
			(candidate) => candidate.id.toLowerCase() === `${slot.param.id.replace('Multiple', '')}UrlMultiple`.toLowerCase(),
		);
		if (multiple) used.add(multiple.id);
	}

	for (const [name, pattern] of SLOT_PATTERNS) {
		if (named[name]) continue;
		const param = params.find((candidate) => !used.has(candidate.id) && pattern.test(candidate.id));
		if (param) {
			named[name] = param;
			used.add(param.id);
		}
	}
	// No field named like a prompt: the first required text area is the prompt.
	if (!named.prompt) {
		const textarea = params.find((candidate) => !used.has(candidate.id) && candidate.type === 'textarea' && candidate.required);
		if (textarea) {
			named.prompt = textarea;
			used.add(textarea.id);
		}
	}
	return { files, named, rest: params.filter((param) => !used.has(param.id)) };
}

/** The first file slot of a kind, preferring required ones. */
export function fileSlot(schema: ModelSchema, kind: FileKind): FileSlot | undefined {
	const slots = slotsFor(schema).files.filter((slot) => slot.kind === kind);
	return slots.find((slot) => slot.param.required) ?? slots[0];
}
