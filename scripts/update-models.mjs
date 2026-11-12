// Rebuilds src/models.json from the public Wiro AI catalog (no API key needed).
//
//   npm run models
//
// The plugin ships this file so its settings can show each model's options
// without a network call. At run time it still reads the model's live
// parameters, so a stale entry only affects what the settings tab shows.
// Edit the lists below to change the models offered in the dropdowns.

import { writeFileSync } from 'node:fs';
import process from 'node:process';

const API = 'https://api.wiro.ai/v1';

const MODELS = {
	image: [
		['google/nano-banana-2-1', 'Nano Banana 2.1'],
		['google/nano-banana-pro', 'Nano Banana Pro'],
		['openai/gpt-image-2', 'GPT Image 2'],
		['bytedance/seedream-v5-pro', 'Seedream 5 Pro'],
		['black-forest-labs/flux-2-pro', 'FLUX.2 Pro'],
		['wiro/flux-2-dev', 'FLUX.2 Dev'],
		['xai/grok-imagine-image', 'Grok Imagine Image'],
		['alibaba/qwen-image-3-0', 'Qwen Image 3.0'],
		['pruna/p-image', 'P-Image'],
	],
	edit: [
		['google/nano-banana-2-1', 'Nano Banana 2.1'],
		['openai/gpt-image-2', 'GPT Image 2'],
		['bytedance/seedream-v5-pro', 'Seedream 5 Pro'],
		['alibaba/qwen-image-3-0', 'Qwen Image 3.0'],
		['alibaba/wan-2-7-image', 'Wan 2.7 Image'],
	],
	upscale: [
		['wiro/image-restoration', 'Image Restoration'],
		['wiroai/flux-upscaler', 'Flux Upscaler'],
	],
	video: [
		['bytedance/seedance-v1-pro-fast', 'Seedance 1 Pro Fast'],
		['minimax/h3-lite', 'MiniMax H3 Lite'],
		['pruna/p-video-2-pro', 'P-Video 2 Pro'],
		['klingai/kling-v4-flash', 'Kling 4.0 Flash'],
		['alibaba/wan-3-0', 'Wan 3.0'],
		['google/veo3-1', 'Veo 3.1'],
	],
	speech: [
		['elevenlabs/eleven-v4', 'Eleven v4'],
		['elevenlabs/eleven-v4-turbo', 'Eleven v4 Turbo'],
		['google/gemini-3-1-tts', 'Gemini 3.1 Flash TTS'],
		['google/gemini-2-5-tts', 'Gemini 2.5 TTS'],
		['xiaomimimo/mimo-2-5-tts', 'MiMo 2.5 TTS'],
	],
	music: [
		['elevenlabs/text-to-music-v2', 'ElevenLabs Music v2'],
		['elevenlabs/text-to-music-v2-5', 'ElevenLabs Music v2.5'],
		['stabilityai/stable-audio-3-small-music', 'Stable Audio 3 Small'],
		['stabilityai/stable-audio-3-medium', 'Stable Audio 3 Medium'],
	],
	transcribe: [
		['elevenlabs/speech-to-text', 'ElevenLabs Speech to Text'],
		['elevenlabs/scribe-v3', 'Scribe v3'],
		['xiaomimimo/mimo-v2-5-asr', 'MiMo 2.5 ASR'],
		['openai/whisper-large-v3', 'Whisper Large v3'],
	],
};

const FILE_TYPES = new Set(['fileinput', 'multifileinput', 'multifileinputdrop', 'combinefileinput']);

// Defaults of these types are sample inputs (prompts, file URLs), never settings.
const NO_DEFAULT_TYPES = new Set([
	'textarea',
	'text',
	'fileinput',
	'multifileinput',
	'multifileinputdrop',
	'combinefileinput',
]);

async function toolDetail(slug) {
	const [slugowner, slugproject] = slug.split('/');
	const response = await fetch(`${API}/Tool/Detail`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'User-Agent': 'wiro-obsidian-catalog' },
		body: JSON.stringify({ slugowner, slugproject }),
	});
	const data = await response.json();
	const tool = Array.isArray(data?.tool) ? data.tool[0] : undefined;
	if (data?.result !== true || !tool) {
		throw new Error(`${slug}: Tool/Detail answered HTTP ${response.status} without the model`);
	}
	return tool;
}

function parameters(tool) {
	const params = [];
	for (const group of Array.isArray(tool.parameters) ? tool.parameters : []) {
		for (const item of Array.isArray(group?.items) ? group.items : []) {
			if (!item?.id || !item?.type) continue;
			const type = String(item.type);
			// Keep what the plugin uses: required parameters get their defaults,
			// select parameters become options, file parameters take uploads.
			if (item.required !== true && type !== 'select' && !FILE_TYPES.has(type) && item.id !== 'prompt') continue;
			const param = {
				id: String(item.id),
				type,
				label: String(item.label ?? item.id),
				required: item.required === true,
				advanced: item.advanced === true,
				defaultValue: NO_DEFAULT_TYPES.has(type) ? '' : String(item.defaultvalue ?? ''),
			};
			if (Array.isArray(item.options) && item.options.length > 0) {
				param.options = item.options
					.filter((option) => option && option.value !== undefined)
					.map((option) => ({ value: String(option.value), label: String(option.text ?? option.value) }));
			}
			params.push(param);
		}
	}
	return params;
}

function priceRows(value) {
	let rows = value;
	if (typeof rows === 'string') {
		try {
			rows = JSON.parse(rows);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(rows)) return [];
	return rows
		.filter((row) => row && typeof row.priceMethod === 'string')
		.map((row) => {
			const entry = { price: Number(row.price) || 0, priceMethod: row.priceMethod };
			if (row.inputs && typeof row.inputs === 'object') entry.inputs = row.inputs;
			if (typeof row.note === 'string' && row.note.trim()) entry.note = row.note.trim();
			if (row.priceExtra !== undefined) entry.priceExtra = Number(row.priceExtra);
			if (row.priceInput !== undefined) entry.priceInput = Number(row.priceInput);
			return entry;
		});
}

// Each model is stored once; features list the models they offer by slug.
const catalog = { features: {}, models: {} };
for (const [feature, list] of Object.entries(MODELS)) {
	catalog.features[feature] = [];
	for (const [slug, name] of list) {
		catalog.features[feature].push([slug, name]);
		if (catalog.models[slug]) continue;
		const tool = await toolDetail(slug);
		const pricing = { rows: priceRows(tool.dynamicprice) };
		const estimate = Number(tool.approximatelycost);
		if (Number.isFinite(estimate) && estimate > 0) pricing.estimatedUsd = estimate;
		catalog.models[slug] = { params: parameters(tool), pricing };
		process.stdout.write(`${feature}: ${slug}\n`);
	}
}

writeFileSync(new URL('../src/models.json', import.meta.url), `${JSON.stringify(catalog)}\n`);
