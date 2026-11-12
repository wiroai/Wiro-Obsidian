import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileStamp, isTextOutput, isWiroFileUrl, kindOfExtension, mimeType, outputExtension, outputFileName, outputKind, splitExtension, uploadName } from '../src/vault/files';
import { placeholderText, planInsertion, topLine } from '../src/vault/placement';

const output = (contentType: string, url: string, name = '') => ({ contentType, url, name });

test('outputExtension picks files of the requested kind', () => {
	assert.equal(outputExtension(output('image/png', 'https://cdn1.wiro.ai/0.png'), 'image'), 'png');
	assert.equal(outputExtension(output('image/jpeg', 'https://cdn1.wiro.ai/0'), 'image'), 'jpg');
	assert.equal(outputExtension(output('', 'https://cdn1.wiro.ai/a/0.webp'), 'image'), 'webp');
	assert.equal(outputExtension(output('audio/mpeg', 'https://cdn1.wiro.ai/0.mp3'), 'audio'), 'mp3');
	assert.equal(outputExtension(output('application/octet-stream', 'https://cdn1.wiro.ai/0.wav'), 'audio'), 'wav');
	assert.equal(outputExtension(output('application/json', 'https://cdn1.wiro.ai/timestamps.json'), 'audio'), null);
	assert.equal(outputExtension(output('video/mp4', 'https://cdn1.wiro.ai/0.mp4'), 'video'), 'mp4');
	assert.equal(outputKind(output('video/mp4', 'https://cdn1.wiro.ai/0.mp4')), 'video');
	assert.equal(outputKind(output('', 'https://cdn1.wiro.ai/0.webp')), 'image');
	assert.equal(outputKind(output('text/plain', 'https://cdn1.wiro.ai/0.txt')), null);
	assert.ok(isTextOutput(output('text/plain', 'https://cdn1.wiro.ai/0.txt')));
	assert.ok(isTextOutput(output('', 'https://cdn1.wiro.ai/transcript.json')));
	assert.ok(!isTextOutput(output('image/png', 'https://cdn1.wiro.ai/0.png')));
	assert.equal(outputExtension(output('raw', ''), 'image'), null);
	assert.equal(outputExtension(output('audio/mpeg', 'https://cdn1.wiro.ai/0.mp3'), 'image'), null);
});

test('only https files on wiro.ai hosts are downloaded', () => {
	assert.ok(isWiroFileUrl('https://cdn1.wiro.ai/uploads/0.png'));
	assert.ok(isWiroFileUrl('https://wiro.ai/x.png'));
	assert.ok(!isWiroFileUrl('http://cdn1.wiro.ai/0.png'));
	assert.ok(!isWiroFileUrl('https://wiro.ai.example.com/0.png'));
	assert.ok(!isWiroFileUrl('https://example.com/0.png'));
	assert.ok(!isWiroFileUrl('not a url'));
});

test('file names follow the Pasted image style', () => {
	assert.equal(fileStamp(new Date(2026, 10, 11, 9, 5, 3)), '20261111090503');
	assert.equal(outputFileName('Wiro image', '20261111090503', 0, 'png'), 'Wiro image 20261111090503.png');
	assert.equal(outputFileName('Wiro image', '20261111090503', 1, 'png'), 'Wiro image 20261111090503 2.png');
	assert.equal(outputFileName('Wiro speech', '20261111090503', 0, 'mp3'), 'Wiro speech 20261111090503.mp3');
	assert.equal(kindOfExtension('MP4'), 'video');
	assert.equal(kindOfExtension('m4a'), 'audio');
	assert.equal(kindOfExtension('md'), null);
	assert.equal(mimeType('jpg'), 'image/jpeg');
	assert.equal(mimeType('weird'), 'application/octet-stream');
	assert.equal(uploadName('Wiro image 20261111.jpg', 1_700_000_000_000), 'obsidian-loyw3v28-Wiro-image-20261111.jpg');
	assert.equal(uploadName('voice (1) .m4a', 0), 'obsidian-0-voice-1.m4a');
	assert.deepEqual(splitExtension('Attachments/Wiro image 1.png'), { base: 'Attachments/Wiro image 1', extension: 'png' });
	assert.deepEqual(splitExtension('folder.v2/file'), { base: 'folder.v2/file', extension: '' });
});

test('placeholders are Obsidian comments with an id', () => {
	assert.equal(placeholderText('generating an image', 'abc123'), '%%Wiro AI is generating an image (abc123)%%');
	assert.equal(placeholderText('transcribing', 'abc123'), '%%Wiro AI is transcribing (abc123)%%');
	assert.notEqual(placeholderText('editing the image'), placeholderText('editing the image'));
	assert.equal(topLine(['# Title', 'text']), 0);
	assert.equal(topLine(['---', 'tags: [a]', '---', 'text']), 3);
	assert.equal(topLine(['---', 'unclosed']), 0);
});

test('planInsertion puts the block in its own paragraph', () => {
	// After a line of text, followed by more text.
	assert.deepEqual(planInsertion('A fox in the snow.', null, 'Next', 'X'), { ch: 18, text: '\n\nX\n' });
	// After the last line.
	assert.deepEqual(planInsertion('A fox in the snow.', null, null, 'X'), { ch: 18, text: '\n\nX' });
	// On an empty line between two paragraphs.
	assert.deepEqual(planInsertion('', 'Before', 'After', 'X'), { ch: 0, text: '\nX\n' });
	// On an empty line in an empty note.
	assert.deepEqual(planInsertion('', null, null, 'X'), { ch: 0, text: 'X' });
});
