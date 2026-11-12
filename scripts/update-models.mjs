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
	speech: [
		['elevenlabs/eleven-v4', 'Eleven v4'],
		['elevenlabs/eleven-v4-turbo', 'Eleven v4 Turbo'],
		['google/gemini-3-1-tts', 'Gemini 3.1 Flash TTS'],
		['google/gemini-2-5-tts', 'Gemini 2.5 TTS'],
		['xiaomimimo/mimo-2-5-tts', 'MiMo 2.5 TTS'],
	],
};

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
			// select parameters become options in the settings tab.
			if (item.required !== true && type !== 'select') continue;
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

const catalog = {};
for (const [kind, list] of Object.entries(MODELS)) {
	catalog[kind] = [];
	for (const [slug, name] of list) {
		const tool = await toolDetail(slug);
		catalog[kind].push({ slug, name, params: parameters(tool) });
		process.stdout.write(`${kind}: ${slug}\n`);
	}
}

writeFileSync(new URL('../src/models.json', import.meta.url), `${JSON.stringify(catalog, null, '\t')}\n`);
