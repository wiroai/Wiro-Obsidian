import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatUsd, matchingRow, priceLine, quote, shortPrice, type PriceRow } from '../src/wiro/pricing';
import { parsePriceRows, parsePricing } from '../src/wiro/schema';
import catalogData from '../src/models.json';

const nanoBanana: PriceRow[] = [
	{ inputs: { resolution: '1K' }, price: 0.0336, priceMethod: 'per-run' },
	{ inputs: { resolution: '2K' }, price: 0.0504, priceMethod: 'per-run' },
	{ inputs: { resolution: '4K' }, price: 0.113, priceMethod: 'per-run' },
];

test('formatUsd follows wiro.ai', () => {
	assert.equal(formatUsd(0), '$0');
	assert.equal(formatUsd(0.0336), '$0.034');
	assert.equal(formatUsd(0.2), '$0.20');
	assert.equal(formatUsd(1.5), '$1.50');
	assert.equal(formatUsd(0.00008), '$0.00008');
});

test('the first row whose inputs all match is billed', () => {
	assert.equal(matchingRow(nanoBanana, { resolution: '2K' })?.price, 0.0504);
	assert.equal(matchingRow(nanoBanana, { resolution: '8K' }), undefined);
	assert.deepEqual(quote({ rows: nanoBanana }, { resolution: '1K' }), {
		amount: 0.0336,
		approximate: false,
		label: '$0.034',
		note: '$0.034 per run.',
	});
});

test('QUANTITY rows bill the highest count at or below what is sent', () => {
	const rows: PriceRow[] = [
		{ inputs: { inputImage: 'QUANTITY:0' }, price: 0.03, priceMethod: 'per-run' },
		{ inputs: { inputImage: 'QUANTITY:1' }, price: 0.045, priceMethod: 'per-run' },
	];
	assert.equal(matchingRow(rows, {})?.price, 0.03);
	assert.equal(matchingRow(rows, { inputImage: ['a', 'b'] })?.price, 0.045);
});

test('per character, per input second and per output video second prices', () => {
	assert.equal(quote({ rows: [{ price: 0.00008, priceMethod: 'per-input-character' }] }, {}, { promptChars: 222 }).label, '$0.018');
	assert.equal(quote({ rows: [{ price: 0.00008, priceMethod: 'per-input-character' }] }, {}).label, '$0.00008 / character');
	assert.equal(quote({ rows: [{ price: 0.00008, priceMethod: 'per-input-character' }] }, {}).note, '$0.00008 per prompt character.');
	assert.equal(quote({ rows: [{ price: 0.0001, priceMethod: 'per-input-audio-second' }] }, {}, { mediaSeconds: 60 }).label, 'about $0.006');
	assert.equal(quote({ rows: [{ price: 0.0001, priceMethod: 'per-input-audio-second' }] }, {}, { mediaSeconds: 60 }).note, 'About $0.006 for 60 seconds of input audio.');
	assert.equal(quote({ rows: [{ price: 0.05, priceMethod: 'per-output-video-second' }] }, { duration: '5' }).label, '$0.25');
	assert.equal(quote({ rows: [{ price: 0.05, priceMethod: 'per-output-video-second' }] }, {}).note, '$0.05 per second of output video.');
});

test('a price per second of input video counts each input at most maxSeconds', () => {
	const vsr: PriceRow[] = [
		{ inputs: { resolution: '720p' }, price: 0.015, priceMethod: 'per-input-video-second', maxSeconds: 60 },
		{ inputs: { resolution: '1080p' }, price: 0.025, priceMethod: 'per-input-video-second', maxSeconds: 60 },
	];
	assert.deepEqual(quote({ rows: vsr }, { resolution: '1080p' }), {
		approximate: true,
		label: '$0.025 / video second',
		note: '$0.025 per second of input video. Each input counts at most 60 seconds.',
	});
	assert.equal(quote({ rows: vsr }, { resolution: '720p' }, { mediaSeconds: 20 }).note, 'About $0.30 for 20 seconds of input video.');
	const long = quote({ rows: vsr }, { resolution: '720p' }, { mediaSeconds: 90 });
	assert.equal(long.label, 'about $0.90');
	assert.equal(long.note, 'About $0.90 for 60 seconds of input video. Only the first 60 seconds of each input are processed and billed.');
	assert.equal(shortPrice({ rows: vsr }), 'from $0.015 / video second');
	assert.deepEqual(parsePriceRows('[{"inputs":{},"price":0.015,"priceMethod":"per-input-video-second","maxSeconds":60}]'), [
		{ inputs: {}, price: 0.015, priceMethod: 'per-input-video-second', maxSeconds: 60 },
	]);
});

test('an old price-method id is billed by run time', () => {
	for (const old of ['cpr', 'cps', 'cpo', 'cpt', 'cp-pixel', 'cp-promptlength', 'cp-audiosecondslength', 'cp-outputVideoLength', 'cp-realtimeturn', 'cp-readoutput', 'cp', 'cp-request', 'cp-image', 'cp-frame', 'cp-byte']) {
		assert.equal(quote({ rows: [{ price: 0.5, priceMethod: old }] }, {}).label, 'by run time', old);
		assert.equal(shortPrice({ rows: [{ price: 0.5, priceMethod: old }] }), 'by run time', old);
	}
	assert.equal(quote({ rows: [{ price: 0, priceMethod: 'per-realtime-turn' }] }, {}).label, 'per conversation turn');
});

test('the bundled models carry only the price methods Wiro bills by', () => {
	const known = new Set(['per-run', 'per-run-second', 'per-output-file', 'per-total-token', 'per-output-megapixel', 'per-input-character', 'per-input-audio-second', 'per-input-video-second', 'per-output-video-second', 'per-realtime-turn', 'reported-price']);
	const methods = Object.values(catalogData.models).flatMap((model) => model.pricing.rows.map((row) => row.priceMethod));
	assert.ok(methods.length > 0);
	assert.deepEqual(methods.filter((method) => !known.has(method)), []);
});

test('outputs, discounts, run time and set-when-it-ends', () => {
	assert.equal(quote({ rows: [{ price: 0.03, priceMethod: 'per-output-file' }] }, { samples: 2 }).label, '$0.06');
	assert.equal(quote({ rows: nanoBanana, discountPercent: 50 }, { resolution: '1K' }).label, '$0.017');
	assert.equal(quote({ rows: [], estimatedUsd: 0.0132 }, {}).label, 'about $0.013');
	assert.equal(quote({ rows: [] }, {}).label, 'by run time');
	assert.equal(quote({ rows: [{ price: 0, priceMethod: 'reported-price' }] }, {}).label, 'set when it ends');
	assert.equal(quote({ rows: [{ price: 0, priceMethod: 'per-run' }] }, {}).label, 'Free');
});

test('priceLine reads as one sentence', () => {
	assert.equal(priceLine(quote({ rows: nanoBanana }, { resolution: '1K' })), '$0.034 per run.');
	assert.equal(priceLine(quote({ rows: [{ price: 0.00008, priceMethod: 'per-input-character' }] }, {}, { promptChars: 222 })), '$0.018 for 222 prompt characters.');
	assert.equal(priceLine(quote({ rows: [], estimatedUsd: 0.0132 }, {})), 'about $0.013. Billed by run time; this is the average of past runs.');
	assert.equal(priceLine({ approximate: true, label: 'Free' }), 'Free');
});

test('shortPrice for catalog rows', () => {
	assert.equal(shortPrice({ rows: nanoBanana }), 'from $0.034');
	assert.equal(shortPrice({ rows: [{ price: 0.04, priceMethod: 'per-output-file' }] }), '$0.04 / output');
	assert.equal(shortPrice({ rows: [{ price: 0.00008, priceMethod: 'per-input-character' }] }), '$0.00008 / character');
	assert.equal(shortPrice({ rows: [], estimatedUsd: 0.11 }), 'about $0.11');
	assert.equal(shortPrice({ rows: [{ price: 0, priceMethod: 'reported-price' }] }), 'set when it ends');
});

test('dynamicprice is read from a JSON string or an array', () => {
	const fromString = parsePriceRows('[{"inputs":{"duration":"5"},"price":0.05,"priceMethod":"per-run"}]');
	assert.deepEqual(fromString, [{ inputs: { duration: '5' }, price: 0.05, priceMethod: 'per-run' }]);
	assert.deepEqual(parsePriceRows('not json'), []);
	assert.deepEqual(parsePricing({ dynamicprice: [], approximatelycost: '0.1088' }), { rows: [], estimatedUsd: 0.1088 });
});
