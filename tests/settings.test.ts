import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bundledSchema, catalogModels, defaultModel, FEATURE_IDS, FEATURES, selectedModel } from '../src/catalog';
import { defaultSettings, folderFor, HISTORY_LIMIT, normalizeSettings } from '../src/settings';
import { optionParams, requiredDefaults } from '../src/wiro/schema';
import { fileSlot } from '../src/wiro/slots';

test('normalizeSettings keeps values of the right type only', () => {
	assert.deepEqual(normalizeSettings(null), defaultSettings());
	const settings = normalizeSettings({
		features: { image: { model: 'openai/gpt-image-2', extraParams: '{"seed": 1}' }, video: { model: 42 } },
		speechPlainText: false,
		imageFolder: 42,
		transcriptStyle: 'quote',
		modelOptions: { 'openai/gpt-image-2': { ratio: '16:9', quality: 3 }, broken: 'x' },
		history: [{ at: 1, label: 'Image generation', model: 'a/b', files: ['x.png', 3] }, { label: 'missing at' }],
		unknown: true,
	});
	assert.equal(settings.features.image.model, 'openai/gpt-image-2');
	assert.equal(settings.features.image.extraParams, '{"seed": 1}');
	assert.equal(settings.features.video.model, defaultModel('video'));
	assert.equal(settings.speechPlainText, false);
	assert.equal(settings.imageFolder, '');
	assert.equal(settings.transcriptStyle, 'quote');
	assert.deepEqual(settings.modelOptions, { 'openai/gpt-image-2': { ratio: '16:9' } });
	assert.deepEqual(settings.history, [{ at: 1, label: 'Image generation', model: 'a/b', files: ['x.png'] }]);
	assert.ok(!('unknown' in settings));
});

test('1.0 settings move to their new places', () => {
	const settings = normalizeSettings({
		imageModel: 'custom',
		imageCustomModel: 'google/veo3-1',
		imageExtraParams: '{"seed": 42}',
		speechModel: 'elevenlabs/eleven-v4-turbo',
		speechFolder: 'Audio',
		imageFolder: 'Images',
	});
	assert.equal(settings.features.image.model, 'google/veo3-1');
	assert.equal(settings.features.image.extraParams, '{"seed": 42}');
	assert.equal(settings.features.speech.model, 'elevenlabs/eleven-v4-turbo');
	assert.equal(settings.audioFolder, 'Audio');
	assert.equal(folderFor(settings, 'image'), 'Images');
	assert.equal(folderFor(settings, 'audio'), 'Audio');
});

test('history is capped', () => {
	const history = Array.from({ length: HISTORY_LIMIT + 5 }, (_, index) => ({ at: index, label: 'x', model: 'a/b', files: [] }));
	assert.equal(normalizeSettings({ history }).history.length, HISTORY_LIMIT);
});

test('every feature has built-in models, the first being the default', () => {
	for (const id of FEATURE_IDS) {
		assert.ok(catalogModels(id).length > 0, id);
		assert.equal(defaultSettings().features[id].model, catalogModels(id)[0]?.slug);
	}
});

test('every built-in model has what its feature needs', () => {
	for (const id of FEATURE_IDS) {
		const feature = FEATURES[id];
		for (const model of catalogModels(id)) {
			const schema = bundledSchema(model.slug);
			assert.ok(schema, model.slug);
			if (feature.takesText) assert.ok(schema.params.some((param) => param.id === 'prompt'), `${model.slug} has a prompt`);
			if (feature.input) assert.ok(fileSlot(schema, feature.input), `${model.slug} takes a ${feature.input} file`);
			for (const param of schema.params.filter((entry) => entry.required && entry.type === 'select')) {
				assert.ok(param.id in requiredDefaults(schema), `${model.slug}: ${param.id} has a default`);
			}
			for (const param of optionParams(schema)) {
				assert.ok((param.options?.length ?? 0) > 0, `${model.slug}: ${param.id} has options`);
			}
		}
	}
});

test('selectedModel resolves built-in and other models', () => {
	const settings = defaultSettings();
	assert.deepEqual(selectedModel(settings, 'image'), { slug: 'google/nano-banana-2-1', name: 'Nano Banana 2.1' });
	settings.features.video.model = 'https://wiro.ai/models/google/veo3-1';
	assert.deepEqual(selectedModel(settings, 'video'), { slug: 'google/veo3-1', name: 'Veo 3.1' });
	settings.features.music.model = 'someone/new-model';
	assert.deepEqual(selectedModel(settings, 'music'), { slug: 'someone/new-model', name: 'someone/new-model' });
	settings.features.speech.model = '';
	assert.equal(selectedModel(settings, 'speech').slug, null);
});
