import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildRunParams,
	defaultOption,
	optionParams,
	parseExtraParams,
	parseModelSlug,
	parseToolDetail,
	requiredDefaults,
	sentenceCaseLabel,
	textParamId,
} from '../src/wiro/schema';

const detail = {
	result: true,
	tool: [
		{
			parameters: [
				{
					items: [
						{ id: 'inputImage', type: 'combinefileinput', required: false, defaultvalue: 'https://cdn.wiro.ai/sample.jpg' },
						{ id: 'prompt', type: 'textarea', required: true, defaultvalue: 'A sample prompt' },
						{
							id: 'resolution',
							type: 'select',
							label: 'Resolution',
							required: true,
							defaultvalue: '1K',
							options: [
								{ text: '1K', value: '1K' },
								{ text: '2K', value: '2K' },
							],
						},
						{
							id: 'aspectRatio',
							type: 'select',
							label: 'Aspect Ratio',
							required: false,
							advanced: true,
							defaultvalue: 'auto',
							options: [
								{ text: 'auto', value: 'auto' },
								{ text: '16:9', value: '16:9' },
							],
						},
						{ id: 'samples', type: 'number', required: true, defaultvalue: '1' },
						{ id: 'seed', type: 'number', required: false, defaultvalue: '7' },
						{ id: 'timestamps', type: 'select', required: false, defaultvalue: 'false', options: [{ text: 'False', value: 'false' }] },
					],
				},
			],
		},
	],
};

test('parseToolDetail reads parameters and drops sample prompts and file URLs', () => {
	const schema = parseToolDetail('google/nano-banana-2-1', detail);
	assert.ok(schema);
	assert.equal(schema.params.length, 7);
	assert.equal(schema.params.find((param) => param.id === 'prompt')?.defaultValue, '');
	assert.equal(schema.params.find((param) => param.id === 'inputImage')?.defaultValue, '');
	assert.deepEqual(schema.params.find((param) => param.id === 'resolution')?.options, [
		{ value: '1K', label: '1K' },
		{ value: '2K', label: '2K' },
	]);
	assert.equal(parseToolDetail('x/y', { result: true, tool: [] }), null);
	assert.equal(parseToolDetail('x/y', 'not json'), null);
});

test('requiredDefaults fills required selects and numbers only', () => {
	const schema = parseToolDetail('a/b', detail);
	assert.ok(schema);
	assert.deepEqual(requiredDefaults(schema), { resolution: '1K', samples: 1 });
});

test('optionParams lists selects and hides format-only ones', () => {
	const schema = parseToolDetail('a/b', detail);
	assert.ok(schema);
	assert.deepEqual(
		optionParams(schema).map((param) => param.id),
		['resolution', 'aspectRatio'],
	);
});

test('buildRunParams: defaults, then saved options the model still offers, then extras, then the prompt', () => {
	const schema = parseToolDetail('a/b', detail);
	const params = buildRunParams(
		schema,
		'a red fox',
		{ aspectRatio: '16:9', resolution: '8K' },
		{ seed: 42, prompt: 'ignored' },
	);
	assert.deepEqual(params, { resolution: '1K', samples: 1, aspectRatio: '16:9', seed: 42, prompt: 'a red fox' });
});

test('buildRunParams works without a schema', () => {
	assert.deepEqual(buildRunParams(null, 'hello', { voice: 'alice' }, {}), { prompt: 'hello' });
});

test('textParamId prefers prompt', () => {
	assert.equal(textParamId(null), 'prompt');
	assert.equal(textParamId({ slug: 'a/b', params: [{ id: 'inputText', type: 'textarea', label: '', required: true, advanced: false, defaultValue: '' }] }), 'inputText');
});

test('defaultOption falls back to the first option', () => {
	assert.equal(defaultOption({ id: 'x', type: 'select', label: '', required: false, advanced: false, defaultValue: 'b', options: [{ value: 'a', label: 'a' }, { value: 'b', label: 'b' }] }), 'b');
	assert.equal(defaultOption({ id: 'x', type: 'select', label: '', required: false, advanced: false, defaultValue: 'z', options: [{ value: 'a', label: 'a' }] }), 'a');
});

test('parseModelSlug accepts slugs and model page URLs', () => {
	assert.equal(parseModelSlug('google/nano-banana-pro'), 'google/nano-banana-pro');
	assert.equal(parseModelSlug('  https://wiro.ai/models/google/veo3-1?tab=api '), 'google/veo3-1');
	assert.equal(parseModelSlug('wiro.ai/models/black-forest-labs/flux-2-pro/'), 'black-forest-labs/flux-2-pro');
	assert.equal(parseModelSlug('nano-banana'), null);
	assert.equal(parseModelSlug('a/b/c'), null);
	assert.equal(parseModelSlug(''), null);
});

test('sentenceCaseLabel', () => {
	assert.equal(sentenceCaseLabel('Aspect Ratio'), 'Aspect ratio');
	assert.equal(sentenceCaseLabel('outputFormat'), 'Output format');
	assert.equal(sentenceCaseLabel('Resolution (K)'), 'Resolution (K)');
	assert.equal(sentenceCaseLabel('voice'), 'Voice');
	assert.equal(sentenceCaseLabel('Text Normalization'), 'Text normalization');
});

test('parseExtraParams', () => {
	assert.deepEqual(parseExtraParams(''), {});
	assert.deepEqual(parseExtraParams(' {"seed": 42} '), { seed: 42 });
	assert.throws(() => parseExtraParams('{seed: 42}'), /valid JSON/);
	assert.throws(() => parseExtraParams('[1, 2]'), /JSON object/);
});
