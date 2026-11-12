import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WiroClient } from '../src/wiro/client';
import { WiroApiError } from '../src/wiro/errors';
import { fakeHttp, ok, refused, task } from './helpers';

test('run posts the parameters as JSON with the key and returns the task', async () => {
	const { http, requests } = fakeHttp(() => ok({ taskid: '123', socketaccesstoken: 'tok' }));
	const client = new WiroClient(http, { apiKey: 'key-1' });
	assert.deepEqual(await client.run('google/nano-banana-2-1', { prompt: 'a fox' }), { taskId: '123', token: 'tok' });
	const [request] = requests;
	assert.equal(request?.route, '/Run/google/nano-banana-2-1');
	assert.equal(request?.method, 'POST');
	assert.equal(request?.headers?.['x-api-key'], 'key-1');
	assert.deepEqual(request?.json, { prompt: 'a fox' });
});

test('result: false becomes a WiroApiError with the message and code', async () => {
	const { http } = fakeHttp(() => refused('Insufficient balance', 97));
	const client = new WiroClient(http, { apiKey: 'k' });
	await assert.rejects(client.run('a/b', {}), (error: unknown) => {
		assert.ok(error instanceof WiroApiError);
		assert.equal(error.message, 'Insufficient balance');
		assert.equal(error.code, 97);
		return true;
	});
});

test('a wrong key answers 401', async () => {
	const { http } = fakeHttp(() => refused('Project authorization is not founded.', 0, 401));
	const client = new WiroClient(http, { apiKey: 'wrong' });
	await assert.rejects(client.checkKey(), (error: unknown) => error instanceof WiroApiError && error.status === 401);
});

test('a body that is not JSON is an error', async () => {
	const { http } = fakeHttp(() => ({ status: 502, body: '<html>Bad gateway</html>' }));
	const client = new WiroClient(http, { apiKey: 'k' });
	await assert.rejects(client.taskDetail('tok'), (error: unknown) => error instanceof WiroApiError && error.retryable);
});

test('a network failure is a retryable error', async () => {
	const client = new WiroClient(
		() => Promise.reject(new Error('net::ERR_INTERNET_DISCONNECTED')),
		{ apiKey: 'k' },
	);
	await assert.rejects(client.taskDetail('tok'), (error: unknown) => {
		assert.ok(error instanceof WiroApiError);
		assert.ok(error.retryable);
		assert.match(error.message, /Could not reach api\.wiro\.ai/);
		return true;
	});
});

test('calls that need a key refuse to run without one', async () => {
	const { http, requests } = fakeHttp(() => ok());
	const client = new WiroClient(http, null);
	await assert.rejects(client.run('a/b', {}), /API key/);
	assert.equal(requests.length, 0);
});

test('taskDetail reads status, outputs and cost', async () => {
	const { http, requests } = fakeHttp(() =>
		task('task_postprocess_end', {
			pexit: '0',
			totalcost: '0.0336',
			outputs: [{ name: '0.png', contenttype: 'image/png', size: '2048', url: 'https://cdn1.wiro.ai/x/0.png' }],
		}),
	);
	const client = new WiroClient(http, { apiKey: 'k' });
	const state = await client.taskDetail('tok');
	assert.equal(state?.status, 'task_postprocess_end');
	assert.equal(state?.pexit, '0');
	assert.equal(state?.totalCost, '0.0336');
	assert.deepEqual(state?.outputs, [{ name: '0.png', contentType: 'image/png', url: 'https://cdn1.wiro.ai/x/0.png', size: 2048 }]);
	assert.deepEqual(requests[0]?.json, { tasktoken: 'tok' });
});

test('toolDetail is sent without the key', async () => {
	const { http, requests } = fakeHttp(() =>
		ok({ tool: [{ parameters: [{ items: [{ id: 'prompt', type: 'textarea', required: true }] }] }] }),
	);
	const client = new WiroClient(http, { apiKey: 'secret-key' });
	const schema = await client.toolDetail('google/veo3-1');
	assert.equal(schema.params[0]?.id, 'prompt');
	assert.equal(requests[0]?.headers?.['x-api-key'], undefined);
	assert.deepEqual(requests[0]?.json, { slugowner: 'google', slugproject: 'veo3-1' });
});

test('cancel and kill use the task id and the token', async () => {
	const { http, requests } = fakeHttp(() => ok());
	const client = new WiroClient(http, { apiKey: 'k' });
	await client.cancel('123');
	await client.kill('tok');
	assert.deepEqual(
		requests.map((request) => [request.route, request.json]),
		[
			['/Task/Cancel', { taskid: '123' }],
			['/Task/Kill', { socketaccesstoken: 'tok' }],
		],
	);
});
