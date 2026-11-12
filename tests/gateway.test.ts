import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bearerToken, GatewayClient, readChunk, takeSseData, type StreamTransport } from '../src/wiro/gateway';
import { answerText, transcriptText } from '../src/wiro/outputs';
import { tail, textMessages } from '../src/text/prompts';
import { embedFits, findEmbeds } from '../src/vault/embeds';
import { fakeHttp } from './helpers';

test('takeSseData returns whole events and keeps the rest', () => {
	const { data, rest } = takeSseData('data: {"a":1}\n\ndata: {"b":2}\r\n\r\ndata: {"c"');
	assert.deepEqual(data, ['{"a":1}', '{"b":2}']);
	assert.equal(rest, 'data: {"c"');
	assert.deepEqual(takeSseData(': keep-alive\n\n').data, []);
});

test('readChunk reads deltas, messages, usage cost and errors', () => {
	assert.deepEqual(readChunk({ choices: [{ delta: { content: 'Hel' }, finish_reason: null }], usage: null }), { text: 'Hel' });
	assert.deepEqual(readChunk({ choices: [], usage: { cost: 0.0008 } }), { text: '', costUsd: 0.0008 });
	assert.deepEqual(readChunk({ choices: [{ message: { content: 'Hi' }, finish_reason: 'stop' }] }), { text: 'Hi', finishReason: 'stop' });
	assert.equal(readChunk({ error: { message: 'model not found' } }).error, 'model not found');
});

test('bearerToken adds the secret for signature projects', () => {
	assert.equal(bearerToken({ apiKey: 'k' }), 'Bearer k');
	assert.equal(bearerToken({ apiKey: 'k', apiSecret: 's' }), 'Bearer k:s');
});

test('chat streams through the transport and reports the cost', async () => {
	const pieces: string[] = [];
	let sent: { url: string; headers: Record<string, string>; body: string } | undefined;
	const transport: StreamTransport = (request, onData) => {
		sent = request;
		onData('data: {"choices":[{"delta":{"content":"Hello "}}]}\n\ndata: {"choices":[{"delta":{"content":"there"}}]}\n\n');
		onData('data: {"choices":[],"usage":{"cost":0.0004}}\n\ndata: [DONE]\n\n');
		return Promise.resolve({ status: 200 });
	};
	const { http } = fakeHttp(() => ({ body: {} }));
	const client = new GatewayClient(http, { apiKey: 'key' }, transport);
	const result = await client.chat('google/gemini-3-flash', [{ role: 'user', content: 'hi' }], { onText: (text) => pieces.push(text) });
	assert.deepEqual(pieces, ['Hello ', 'there']);
	assert.deepEqual(result, { text: 'Hello there', costUsd: 0.0004 });
	assert.equal(sent?.url, 'https://llm.wiro.ai/v1/chat/completions');
	assert.equal(sent?.headers.Authorization, 'Bearer key');
	assert.equal((JSON.parse(sent?.body ?? '{}') as { stream?: boolean }).stream, true);
});

test('without a transport, chat makes one request', async () => {
	const { http, requests } = fakeHttp(() => ({ body: { choices: [{ message: { content: 'Answer' }, finish_reason: 'stop' }], usage: { cost: 0.001 } } }));
	const client = new GatewayClient(http, { apiKey: 'key' }, null);
	const result = await client.chat('m', [{ role: 'user', content: 'q' }]);
	assert.deepEqual(result, { text: 'Answer', costUsd: 0.001, finishReason: 'stop' });
	assert.equal(requests[0]?.method, 'POST');
	assert.equal((requests[0]?.json as { stream?: boolean }).stream, undefined);
});

test('a refused key is explained', async () => {
	const { http } = fakeHttp(() => ({ status: 401, body: { error: { message: 'Invalid API key' } } }));
	await assert.rejects(new GatewayClient(http, { apiKey: 'bad' }, null).chat('m', []), /API key was not accepted/);
});

test('models lists ids, names without the "(Wiro)" prefix and prices per million tokens', async () => {
	const { http } = fakeHttp(() => ({
		body: { data: [{ id: 'google/gemini-3-flash', name: '(Wiro) Gemini 3 Flash', context_length: 1000, pricing: { prompt: '0.0000005', completion: '0.000003' } }] },
	}));
	const models = await new GatewayClient(http, null, null).models();
	assert.equal(models[0]?.name, 'Gemini 3 Flash');
	assert.ok(Math.abs((models[0]?.inputPerMillion ?? 0) - 0.5) < 1e-9);
	assert.ok(Math.abs((models[0]?.outputPerMillion ?? 0) - 3) < 1e-9);
});

test('answerText and transcriptText', () => {
	const raw = { outputs: [{ name: '', url: '', contentType: 'raw', content: { segments: [{ type: 'thinking', text: 'x' }, { type: 'answer', text: 'Yes.' }] } }], debugOutput: 'Yes.' };
	assert.equal(answerText(raw), 'Yes.');
	assert.equal(answerText({ outputs: [], debugOutput: ' hello ' }), 'hello');
	assert.equal(answerText({ outputs: [{ name: 'a.txt', url: 'https://cdn1.wiro.ai/a.txt', contentType: 'text/plain' }], debugOutput: 'log' }), '');
	assert.equal(transcriptText('{"text":"Hello world","words":[]}'), 'Hello world');
	assert.equal(transcriptText('[{"text":"one"},{"text":"two"}]'), 'one two');
	assert.equal(transcriptText(' plain text '), 'plain text');
});

test('text prompts carry the action, the language and the question', () => {
	assert.match(textMessages('translate', 'Merhaba', 'German')[0]?.content ?? '', /into German/);
	assert.match(textMessages('ask', 'note text', 'When?')[1]?.content ?? '', /Question: When\?/);
	assert.equal(textMessages('rewrite', 'abc')[1]?.content, 'abc');
	assert.equal(tail('a'.repeat(10), 20), 'a'.repeat(10));
	assert.equal(tail('first paragraph\n\nsecond paragraph is here', 30), 'second paragraph is here');
});

test('findEmbeds finds image, audio and video embeds in both link styles', () => {
	const note = ['Intro', '![[Wiro image 1.png]] and ![[clip.mp4|300]]', '![voice](Attachments/voice%20note.m4a)', '![remote](https://x.com/a.png) ![[note]] [[a.png]]'].join('\n');
	assert.deepEqual(findEmbeds(note), [
		{ target: 'Wiro image 1.png', line: 1, kind: 'image', extension: 'png' },
		{ target: 'clip.mp4', line: 1, kind: 'video', extension: 'mp4' },
		{ target: 'Attachments/voice note.m4a', line: 2, kind: 'audio', extension: 'm4a' },
	]);
});

test('a .webm recording counts as audio for transcription, and stays a video otherwise', () => {
	const [recording, clip, photo] = findEmbeds('![[Recording 20261111153012.webm]]\n![[clip.MP4]]\n![[photo.png]]');
	assert.ok(recording && clip && photo);
	assert.equal(recording.kind, 'video');
	assert.equal(embedFits(recording, 'audio'), true);
	assert.equal(embedFits(recording, 'video'), true);
	assert.equal(embedFits(clip, 'audio'), false);
	assert.equal(clip.extension, 'mp4');
	assert.equal(embedFits(photo, 'audio'), false);
	assert.equal(embedFits(photo, 'image'), true);
});
