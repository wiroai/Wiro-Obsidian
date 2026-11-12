import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WiroClient } from '../src/wiro/client';
import { TaskCancelledError, TaskFailedError, TaskTimeoutError, WiroApiError } from '../src/wiro/errors';
import { explainRunError, formatCost, phaseOf, runTask, type TaskPhase } from '../src/wiro/task';
import { fakeHttp, ok, refused, task } from './helpers';

/** A clock that only moves when the code under test sleeps. */
function fakeTime() {
	let time = 1_000_000;
	return {
		now: () => time,
		sleep: (ms: number, signal?: AbortSignal) => {
			if (signal?.aborted) return Promise.reject(new TaskCancelledError());
			time += ms;
			return Promise.resolve();
		},
	};
}

test('runTask polls until task_postprocess_end and returns the outputs', async () => {
	const statuses = ['task_queue', 'task_start', 'task_postprocess_start', 'task_postprocess_end'];
	const { http, requests } = fakeHttp((request) => {
		if (request.route.startsWith('/Run/')) return ok({ taskid: '42', socketaccesstoken: 'tok' });
		const status = statuses.shift() ?? 'task_postprocess_end';
		return task(status, {
			pexit: status === 'task_postprocess_end' ? '0' : '',
			totalcost: '0.0336',
			outputs: status === 'task_postprocess_end' ? [{ name: '0.png', contenttype: 'image/png', url: 'https://cdn1.wiro.ai/0.png' }] : [],
		});
	});
	const phases: TaskPhase[] = [];
	const result = await runTask(new WiroClient(http, { apiKey: 'k' }), 'a/b', { prompt: 'x' }, { ...fakeTime(), onPhase: (phase) => phases.push(phase) });
	assert.equal(result.taskId, '42');
	assert.equal(result.outputs[0]?.url, 'https://cdn1.wiro.ai/0.png');
	assert.equal(result.totalCost, '0.0336');
	assert.deepEqual(phases, ['starting', 'queued', 'running', 'finishing']);
	assert.equal(requests.filter((request) => request.route === '/Task/Detail').length, 4);
});

test('a non-zero exit code is a TaskFailedError with the error text', async () => {
	const { http } = fakeHttp((request) =>
		request.route.startsWith('/Run/')
			? ok({ taskid: '42', socketaccesstoken: 'tok' })
			: task('task_postprocess_end', { pexit: '1', debugerror: 'Prompt was blocked by the safety filter' }),
	);
	await assert.rejects(runTask(new WiroClient(http, { apiKey: 'k' }), 'a/b', {}, fakeTime()), (error: unknown) => {
		assert.ok(error instanceof TaskFailedError);
		assert.match(error.message, /exit code 1/);
		assert.match(error.message, /safety filter/);
		return true;
	});
});

test('task_cancel ends the run as cancelled', async () => {
	const { http } = fakeHttp((request) =>
		request.route.startsWith('/Run/') ? ok({ taskid: '42', socketaccesstoken: 'tok' }) : task('task_cancel'),
	);
	await assert.rejects(runTask(new WiroClient(http, { apiKey: 'k' }), 'a/b', {}, fakeTime()), TaskCancelledError);
});

test('aborting a queued task calls Task/Cancel', async () => {
	const controller = new AbortController();
	const { http, requests } = fakeHttp((request) => {
		if (request.route.startsWith('/Run/')) return ok({ taskid: '42', socketaccesstoken: 'tok' });
		if (request.route === '/Task/Detail') {
			controller.abort();
			return task('task_queue');
		}
		return ok();
	});
	await assert.rejects(
		runTask(new WiroClient(http, { apiKey: 'k' }), 'a/b', {}, { ...fakeTime(), signal: controller.signal }),
		TaskCancelledError,
	);
	assert.deepEqual(requests.at(-1)?.route, '/Task/Cancel');
	assert.deepEqual(requests.at(-1)?.json, { taskid: '42' });
});

test('aborting a running task calls Task/Kill', async () => {
	const controller = new AbortController();
	const { http, requests } = fakeHttp((request) => {
		if (request.route.startsWith('/Run/')) return ok({ taskid: '42', socketaccesstoken: 'tok' });
		if (request.route === '/Task/Detail') {
			controller.abort();
			return task('task_start');
		}
		return ok();
	});
	await assert.rejects(
		runTask(new WiroClient(http, { apiKey: 'k' }), 'a/b', {}, { ...fakeTime(), signal: controller.signal }),
		TaskCancelledError,
	);
	assert.deepEqual(requests.at(-1)?.route, '/Task/Kill');
});

test('with shouldStop false, aborting only stops waiting', async () => {
	const controller = new AbortController();
	const { http, requests } = fakeHttp((request) => {
		if (request.route.startsWith('/Run/')) return ok({ taskid: '42', socketaccesstoken: 'tok' });
		controller.abort();
		return task('task_start');
	});
	await assert.rejects(
		runTask(new WiroClient(http, { apiKey: 'k' }), 'a/b', {}, { ...fakeTime(), signal: controller.signal, shouldStop: () => false }),
		TaskCancelledError,
	);
	assert.ok(requests.every((request) => request.route !== '/Task/Kill' && request.route !== '/Task/Cancel'));
});

test('a concurrency refusal (code 96) is tried again', async () => {
	let runs = 0;
	const { http } = fakeHttp((request) => {
		if (request.route.startsWith('/Run/')) {
			runs += 1;
			return runs < 3 ? refused('Concurrency limit reached', 96) : ok({ taskid: '42', socketaccesstoken: 'tok' });
		}
		return task('task_postprocess_end', { pexit: '0' });
	});
	const phases: TaskPhase[] = [];
	await runTask(new WiroClient(http, { apiKey: 'k' }), 'a/b', {}, { ...fakeTime(), onPhase: (phase) => phases.push(phase) });
	assert.equal(runs, 3);
	assert.ok(phases.includes('waiting'));
});

test('a task that does not finish in time is stopped', async () => {
	const { http, requests } = fakeHttp((request) =>
		request.route.startsWith('/Run/') ? ok({ taskid: '42', socketaccesstoken: 'tok' }) : request.route === '/Task/Detail' ? task('task_start') : ok(),
	);
	await assert.rejects(
		runTask(new WiroClient(http, { apiKey: 'k' }), 'a/b', {}, { ...fakeTime(), timeoutMs: 60_000 }),
		(error: unknown) => error instanceof TaskTimeoutError && /It was stopped/.test(error.message),
	);
	assert.equal(requests.at(-1)?.route, '/Task/Kill');
});

test('a refused key stops polling at once', async () => {
	const { http } = fakeHttp((request) =>
		request.route.startsWith('/Run/') ? ok({ taskid: '42', socketaccesstoken: 'tok' }) : refused('Project authorization is not founded.', 0, 401),
	);
	await assert.rejects(runTask(new WiroClient(http, { apiKey: 'k' }), 'a/b', {}, fakeTime()), /API key was not accepted/);
});

test('explainRunError gives the user a next step', () => {
	const noModel = explainRunError(new WiroApiError('tool-not-accessible'), 'x/y');
	assert.match((noModel as Error).message, /no model "x\/y"/);
	const noFunds = explainRunError(new WiroApiError('Insufficient balance.', { code: 97 }), 'x/y');
	assert.match((noFunds as Error).message, /wiro\.ai\/panel\/billing/);
	const plain = new Error('other');
	assert.equal(explainRunError(plain, 'x/y'), plain);
});

test('phaseOf and formatCost', () => {
	assert.equal(phaseOf('task_accept'), 'queued');
	assert.equal(phaseOf('task_output'), 'running');
	assert.equal(phaseOf('task_postprocess_start'), 'finishing');
	assert.equal(formatCost('0.033600000000'), '$0.0336');
	assert.equal(formatCost('0.000080000000'), '$0.00008');
	assert.equal(formatCost('0'), '$0');
	assert.equal(formatCost(''), '');
});
