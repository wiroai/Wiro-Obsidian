import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMultipart } from '../src/wiro/multipart';
import { composeRunParams, fileValues, type ModelSchema, type ParamDef } from '../src/wiro/schema';
import { fileKind, fileSlot, slotsFor } from '../src/wiro/slots';

const param = (id: string, type: string, extra: Partial<ParamDef> = {}): ParamDef => ({
	id,
	type,
	label: id,
	required: false,
	advanced: false,
	defaultValue: '',
	...extra,
});

const video: ModelSchema = {
	slug: 'minimax/h3-lite',
	params: [
		param('inputImage', 'combinefileinput'),
		param('inputImageUrl', 'text'),
		param('prompt', 'textarea', { required: true }),
		param('durationSeconds', 'number', { required: true, defaultValue: '5' }),
		param('aspectRatio', 'select', { options: [{ value: '16:9', label: '16:9' }] }),
		param('seed', 'number'),
	],
};

test('slotsFor finds files, the prompt, duration and ratio under their own names', () => {
	const slots = slotsFor(video);
	assert.deepEqual(slots.files.map((slot) => [slot.param.id, slot.kind]), [['inputImage', 'image']]);
	assert.equal(slots.named.prompt?.id, 'prompt');
	assert.equal(slots.named.duration?.id, 'durationSeconds');
	assert.equal(slots.named.ratio?.id, 'aspectRatio');
	assert.deepEqual(slots.rest.map((entry) => entry.id), ['seed']);
});

test('fileKind and fileSlot', () => {
	assert.equal(fileKind(param('inputAudio', 'fileinput')), 'audio');
	assert.equal(fileKind(param('inputVideo', 'fileinput')), 'video');
	assert.equal(fileKind(param('inputDocument', 'fileinput')), 'file');
	const stt: ModelSchema = { slug: 'a/b', params: [param('inputAudio', 'fileinput', { required: true })] };
	assert.equal(fileSlot(stt, 'audio')?.param.id, 'inputAudio');
	assert.equal(fileSlot(stt, 'image'), undefined);
});

test('uploaded URLs go in the way each file type takes them', () => {
	assert.deepEqual(fileValues(param('inputAudio', 'fileinput'), ['https://x/a.mp3']), { inputAudio: 'https://x/a.mp3' });
	assert.deepEqual(fileValues(param('inputImage', 'combinefileinput'), ['https://x/1', 'https://x/2']), { inputImage: ['https://x/1', 'https://x/2'] });
	assert.deepEqual(fileValues(param('inputDocumentMultiple', 'multifileinput'), ['https://x/1', 'https://x/2']), {
		inputDocumentUrlMultiple: 'https://x/1,https://x/2',
	});
	assert.deepEqual(
		composeRunParams(video, { text: 'a fox', files: { inputImage: ['https://cdn1.wiro.ai/x.png'] }, values: { aspectRatio: '16:9', seed: '' } }),
		{ durationSeconds: 5, aspectRatio: '16:9', inputImage: ['https://cdn1.wiro.ai/x.png'], prompt: 'a fox' },
	);
	assert.deepEqual(composeRunParams(video, { text: null }), { durationSeconds: 5 });
});

test('buildMultipart writes fields and files with one boundary', () => {
	const file = new TextEncoder().encode('PNGDATA').buffer;
	const { body, contentType } = buildMultipart({ note: 'hi' }, [{ field: 'file', fileName: 'a "b".png', contentType: 'image/png', data: file }], 'XYZ');
	assert.equal(contentType, 'multipart/form-data; boundary=XYZ');
	const text = new TextDecoder().decode(body);
	assert.equal(
		text,
		'--XYZ\r\nContent-Disposition: form-data; name="note"\r\n\r\nhi\r\n' +
			'--XYZ\r\nContent-Disposition: form-data; name="file"; filename="a %22b%22.png"\r\nContent-Type: image/png\r\n\r\nPNGDATA\r\n' +
			'--XYZ--\r\n',
	);
});
