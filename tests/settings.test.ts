import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bundledSchema, catalogModels, selectedModel } from '../src/catalog';
import { CUSTOM_MODEL, DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { optionParams, requiredDefaults } from '../src/wiro/schema';

test('normalizeSettings keeps values of the right type only', () => {
	assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
	const settings = normalizeSettings({
		imageModel: 'openai/gpt-image-2',
		speechPlainText: false,
		imageFolder: 42,
		modelOptions: { 'openai/gpt-image-2': { ratio: '16:9', quality: 3 }, broken: 'x' },
		unknown: true,
	});
	assert.equal(settings.imageModel, 'openai/gpt-image-2');
	assert.equal(settings.speechPlainText, false);
	assert.equal(settings.imageFolder, '');
	assert.deepEqual(settings.modelOptions, { 'openai/gpt-image-2': { ratio: '16:9' } });
	assert.ok(!('unknown' in settings));
});

test('the defaults point at listed models', () => {
	assert.ok(catalogModels('image').some((model) => model.slug === DEFAULT_SETTINGS.imageModel));
	assert.ok(catalogModels('speech').some((model) => model.slug === DEFAULT_SETTINGS.speechModel));
});

test('every listed model has a prompt parameter and usable defaults', () => {
	for (const kind of ['image', 'speech'] as const) {
		for (const model of catalogModels(kind)) {
			const schema = bundledSchema(model.slug);
			assert.ok(schema, model.slug);
			assert.ok(schema.params.some((param) => param.id === 'prompt'), `${model.slug} has a prompt`);
			for (const param of schema.params.filter((entry) => entry.required && entry.type === 'select')) {
				assert.ok(param.id in requiredDefaults(schema), `${model.slug}: ${param.id} has a default`);
			}
			for (const param of optionParams(schema)) {
				assert.ok((param.options?.length ?? 0) > 0, `${model.slug}: ${param.id} has options`);
			}
		}
	}
});

test('selectedModel resolves listed, other and stale choices', () => {
	assert.deepEqual(selectedModel(DEFAULT_SETTINGS, 'image'), { slug: 'google/nano-banana-2-1', name: 'Nano Banana 2.1' });
	const custom = { ...DEFAULT_SETTINGS, imageModel: CUSTOM_MODEL, imageCustomModel: 'https://wiro.ai/models/google/veo3-1' };
	assert.deepEqual(selectedModel(custom, 'image'), { slug: 'google/veo3-1', name: 'google/veo3-1' });
	const empty = { ...DEFAULT_SETTINGS, speechModel: CUSTOM_MODEL, speechCustomModel: '' };
	assert.equal(selectedModel(empty, 'speech').slug, null);
	const stale = { ...DEFAULT_SETTINGS, imageModel: 'someone/old-model' };
	assert.deepEqual(selectedModel(stale, 'image'), { slug: 'someone/old-model', name: 'someone/old-model' });
});
