import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatUsd, matchingRow, priceLine, quote, shortPrice, type PriceRow } from '../src/wiro/pricing';
import { parsePriceRows, parsePricing } from '../src/wiro/schema';

const nanoBanana: PriceRow[] = [
	{ inputs: { resolution: '1K' }, price: 0.0336, priceMethod: 'cpr' },
	{ inputs: { resolution: '2K' }, price: 0.0504, priceMethod: 'cpr' },
	{ inputs: { resolution: '4K' }, price: 0.113, priceMethod: 'cpr' },
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
		{ inputs: { inputImage: 'QUANTITY:0' }, price: 0.03, priceMethod: 'cpr' },
		{ inputs: { inputImage: 'QUANTITY:1' }, price: 0.045, priceMethod: 'cpr' },
	];
	assert.equal(matchingRow(rows, {})?.price, 0.03);
	assert.equal(matchingRow(rows, { inputImage: ['a', 'b'] })?.price, 0.045);
});

test('per character, per audio second and per video second prices', () => {
	assert.equal(quote({ rows: [{ price: 0.00008, priceMethod: 'cp-promptlength' }] }, {}, { promptChars: 222 }).label, '$0.018');
	assert.equal(quote({ rows: [{ price: 0.00008, priceMethod: 'cp-promptlength' }] }, {}).label, '$0.00008 / character');
	assert.equal(quote({ rows: [{ price: 0.0001, priceMethod: 'cp-audiosecondslength' }] }, {}, { mediaSeconds: 60 }).label, 'about $0.006');
	assert.equal(quote({ rows: [{ price: 0.05, priceMethod: 'cp-outputVideoLength' }] }, { duration: '5' }).label, '$0.25');
});

test('outputs, discounts, run time and set-when-it-ends', () => {
	assert.equal(quote({ rows: [{ price: 0.03, priceMethod: 'cpo' }] }, { samples: 2 }).label, '$0.06');
	assert.equal(quote({ rows: nanoBanana, discountPercent: 50 }, { resolution: '1K' }).label, '$0.017');
	assert.equal(quote({ rows: [], estimatedUsd: 0.0132 }, {}).label, 'about $0.013');
	assert.equal(quote({ rows: [] }, {}).label, 'by run time');
	assert.equal(quote({ rows: [{ price: 0, priceMethod: 'cp-readoutput' }] }, {}).label, 'set when it ends');
	assert.equal(quote({ rows: [{ price: 0, priceMethod: 'cpr' }] }, {}).label, 'Free');
});

test('priceLine reads as one sentence', () => {
	assert.equal(priceLine(quote({ rows: nanoBanana }, { resolution: '1K' })), '$0.034 per run.');
	assert.equal(priceLine(quote({ rows: [{ price: 0.00008, priceMethod: 'cp-promptlength' }] }, {}, { promptChars: 222 })), '$0.018 for 222 characters.');
	assert.equal(priceLine(quote({ rows: [], estimatedUsd: 0.0132 }, {})), 'about $0.013. Billed by run time; this is the average of past runs.');
	assert.equal(priceLine({ approximate: true, label: 'Free' }), 'Free');
});

test('shortPrice for catalog rows', () => {
	assert.equal(shortPrice({ rows: nanoBanana }), 'from $0.034');
	assert.equal(shortPrice({ rows: [{ price: 0.04, priceMethod: 'cpo' }] }), '$0.04 / output');
	assert.equal(shortPrice({ rows: [{ price: 0.00008, priceMethod: 'cp-promptlength' }] }), '$0.00008 / character');
	assert.equal(shortPrice({ rows: [], estimatedUsd: 0.11 }), 'about $0.11');
	assert.equal(shortPrice({ rows: [{ price: 0, priceMethod: 'cp-readoutput' }] }), 'set when it ends');
});

test('dynamicprice is read from a JSON string or an array', () => {
	const fromString = parsePriceRows('[{"inputs":{"duration":"5"},"price":0.05,"priceMethod":"cpr"}]');
	assert.deepEqual(fromString, [{ inputs: { duration: '5' }, price: 0.05, priceMethod: 'cpr' }]);
	assert.deepEqual(parsePriceRows('not json'), []);
	assert.deepEqual(parsePricing({ dynamicprice: [], approximatelycost: '0.1088' }), { rows: [], estimatedUsd: 0.1088 });
});
