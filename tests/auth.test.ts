import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { authHeaders, hmacSha256Hex, nextNonce } from '../src/wiro/auth';

test('hmacSha256Hex matches Node crypto', async () => {
	const expected = createHmac('sha256', 'my-key').update('my-secret1700000000000').digest('hex');
	assert.equal(await hmacSha256Hex('my-key', 'my-secret1700000000000'), expected);
});

test('API key only projects send just x-api-key', async () => {
	assert.deepEqual(await authHeaders({ apiKey: 'k' }), { 'x-api-key': 'k' });
});

test('signature projects send a nonce and HMAC-SHA256(key = API key, message = secret + nonce)', async () => {
	const headers = await authHeaders({ apiKey: 'key-1', apiSecret: 'secret-1' });
	const nonce = headers['x-nonce'];
	assert.ok(nonce && /^\d+$/.test(nonce));
	const expected = createHmac('sha256', 'key-1').update(`secret-1${nonce}`).digest('hex');
	assert.equal(headers['x-signature'], expected);
	assert.equal(headers['x-api-key'], 'key-1');
});

test('nonces never repeat, even within one millisecond', () => {
	const first = Number(nextNonce(5_000_000_000_000));
	const second = Number(nextNonce(5_000_000_000_000));
	assert.ok(second > first);
});
