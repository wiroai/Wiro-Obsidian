import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRunDetail, parseWorkflowDetail, parseWorkflowList, parseWorkflowSlug, resolveRunOutputs } from '../src/wiro/workflow';

test('parseWorkflowSlug takes full slugs and workflow links', () => {
	assert.equal(parseWorkflowSlug('e-commerce-AbC12'), 'e-commerce-AbC12');
	assert.equal(parseWorkflowSlug('https://wiro.ai/workflows/e-commerce-AbC12?tab=run'), 'e-commerce-AbC12');
	assert.equal(parseWorkflowSlug('e-commerce'), null);
	assert.equal(parseWorkflowSlug('a/b-AbC12'), null);
});

test('parseWorkflowList joins slug and slug id', () => {
	const list = parseWorkflowList({ result: true, workflow: [{ slug: 'e-commerce', slugid: 'AbC12', title: 'E-Commerce', stepcount: '7' }, { title: 'no slug' }] });
	assert.deepEqual(list, [{ fullSlug: 'e-commerce-AbC12', title: 'E-Commerce', stepCount: 7 }]);
});

test('parseWorkflowDetail reads the Start inputs, required keys and steps', () => {
	const contents = {
		nodes: { 'node-a': { tool: 'google/nano-banana-2-lite' }, output: { fields: {} } },
		schema: {
			input: {
				product_photo: { label: 'Product photo', type: 'string', description: 'A image field', ui: { field: 'image' } },
				brief: { label: 'Brief', type: 'string', defaultValue: 'Summer sale', ui: { field: 'textarea' } },
				tone: { label: 'Tone', type: 'string', ui: { field: 'select', options: [{ value: 'calm', text: 'Calm' }] } },
			},
		},
	};
	const detail = parseWorkflowDetail({
		result: true,
		workflow: [{ slug: 'shop', slugid: 'XyZ98', title: 'Shop', contents: JSON.stringify(contents), requiredinputs: ['brief'], estimatedcost: { value: '0.42' } }],
	});
	assert.ok(detail);
	assert.equal(detail.fullSlug, 'shop-XyZ98');
	assert.equal(detail.stepCount, 1);
	assert.equal(detail.estimatedUsd, 0.42);
	assert.deepEqual(detail.inputs, [
		{ key: 'product_photo', label: 'Product photo', kind: 'image', required: false },
		{ key: 'brief', label: 'Brief', kind: 'textarea', required: true, defaultValue: 'Summer sale' },
		{ key: 'tone', label: 'Tone', kind: 'select', required: false, options: [{ value: 'calm', label: 'Calm' }] },
	]);
});

test('resolveRunOutputs follows the End node references', () => {
	const contents = {
		nodes: {
			output: {
				fields: {
					Image: '$node-img.outputs',
					Copy: '$node-llm.outputs',
					Brief: '$input.brief',
					Note: 'fixed text',
					Missing: '$node-gone.outputs',
				},
			},
		},
		metadata: { input: { values: { brief: 'Summer sale' } } },
	};
	const nodes = [
		{ nodeId: 'node-img', status: 'completed', outputs: [{ url: 'https://cdn1.wiro.ai/a.png', name: 'a.png', contenttype: 'image/png' }] },
		{ nodeId: 'node-llm', status: 'completed', outputs: [{ contenttype: 'raw', content: { answer: ['Buy ', 'now'] } }] },
	];
	assert.deepEqual(resolveRunOutputs(contents, nodes), {
		Image: [{ url: 'https://cdn1.wiro.ai/a.png', name: 'a.png', mimeType: 'image/png' }],
		Copy: [{ text: 'Buy now' }],
		Brief: [{ text: 'Summer sale' }],
		Note: [{ text: 'fixed text' }],
		Missing: [],
	});
});

test('parseRunDetail counts steps and resolves outputs only when the run ended', () => {
	const running = parseRunDetail({ workflowrun: { status: 'running' }, workflowrunnodes: [{ nodeId: 'a', status: 'completed' }, { nodeId: 'b', status: 'running' }] }, 'tok');
	assert.equal(running.status, 'running');
	assert.equal(running.completedSteps, 1);
	assert.equal(running.totalSteps, 2);
	assert.deepEqual(running.outputs, {});
	const failed = parseRunDetail({ workflowrun: { status: 'failed', chargedcost: '0.03' }, workflowrunnodes: [{ nodeId: 'a', status: 'failed', error: 'Prompt blocked' }] }, 'tok');
	assert.deepEqual(failed.failedSteps, [{ nodeId: 'a', error: 'Prompt blocked' }]);
	assert.equal(failed.chargedUsd, 0.03);
	assert.equal(failed.token, 'tok');
});
