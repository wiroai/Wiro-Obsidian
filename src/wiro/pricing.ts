// The price shown before a run, worked out the way Wiro bills it. Adapted from
// the pricing module of the Wiro AI browser extensions (Wiro-Extension-Core).
//
// - The row: Wiro bills with the first row whose values all match the run's
//   settings. When any row counts files (QUANTITY:n), it bills with the valid
//   row that has the highest total count at or below what the run sends.
// - The charge per method: cpr is the price, cpo the price per output,
//   cp-promptlength per prompt character, cp-audiosecondslength per second of
//   input audio, cp-outputVideoLength per second of output video, cp-pixel per
//   1024 x 1024 block, and a run that matches no row is billed for its run time.

import type { ModelPricing } from './schema';

/** One row of a model's price list, as Wiro stores it (dynamicprice). */
export interface PriceRow {
	price: number;
	priceMethod: string;
	inputs?: Record<string, unknown>;
	note?: string;
	priceExtra?: number;
	priceInput?: number;
}

export interface PriceQuote {
	/** The price for these settings after any discount, when it is known up front. */
	amount?: number;
	/** True when the amount is an estimate or a starting price. */
	approximate: boolean;
	/** Short text: "$0.034", "about $0.02", "from $0.10", "$0.00008 / character". */
	label: string;
	/** One sentence about how the run is billed. */
	note?: string;
}

export interface QuoteContext {
	/** Characters of the prompt, for per-character prices. */
	promptChars?: number;
	/** Seconds of the input audio or video, when known. */
	mediaSeconds?: number;
}

const RUN_TIME = 'Billed by run time.';

export function formatUsd(amount: number): string {
	if (amount === 0) return '$0';
	if (amount >= 1) return `$${amount.toFixed(2)}`;
	if (amount >= 0.01) return `$${trimZeros(amount.toFixed(3))}`;
	return `$${trimZeros(amount.toPrecision(3))}`;
}

function trimZeros(value: string): string {
	if (!value.includes('.')) return value;
	const trimmed = value.replace(/0+$/, '').replace(/\.$/, '');
	// Keep cents readable: 0.2 becomes 0.20.
	return /\.\d$/.test(trimmed) ? `${trimmed}0` : trimmed;
}

function quantityOf(value: unknown): number | null {
	const match = /^QUANTITY:(\d+)$/.exec(asText(value));
	return match ? Number(match[1]) : null;
}

/** How many items a setting sends: list entries, or 1 for any other value. */
function countOf(value: unknown): number {
	if (value === undefined || value === null || value === '') return 0;
	if (Array.isArray(value)) return value.filter((item) => item !== undefined && item !== null && item !== '').length;
	return 1;
}

function asText(value: unknown): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	return JSON.stringify(value) ?? '';
}

function sameValue(expected: unknown, actual: unknown): boolean {
	if (actual === undefined || actual === null) return false;
	if (typeof expected === 'number') return Number(actual) === expected;
	return asText(actual) === asText(expected);
}

const hasQuantity = (row: PriceRow): boolean => Object.values(row.inputs ?? {}).some((value) => quantityOf(value) !== null);

/** The row Wiro bills these settings with, or undefined when none applies. */
export function matchingRow(rows: PriceRow[], params: Record<string, unknown>): PriceRow | undefined {
	if (!rows.some(hasQuantity)) {
		return rows.find((row) => Object.entries(row.inputs ?? {}).every(([key, expected]) => sameValue(expected, params[key])));
	}
	let best: PriceRow | undefined;
	let bestScore = -1;
	for (const row of rows) {
		let score = 0;
		let valid = true;
		for (const [key, expected] of Object.entries(row.inputs ?? {})) {
			const quantity = quantityOf(expected);
			if (quantity === null ? !sameValue(expected, params[key]) : quantity > countOf(params[key])) {
				valid = false;
				break;
			}
			score += quantity ?? 0;
		}
		if (valid && score > bestScore) {
			best = row;
			bestScore = score;
		}
	}
	return best;
}

function countParam(params: Record<string, unknown>): number {
	for (const key of ['n', 'samples', 'numberOfImages', 'numImages', 'numOutputs', 'numberOfOutputs', 'count', 'batchSize', 'numberOfVideos']) {
		const value = Number(params[key]);
		if (Number.isFinite(value) && value > 0) return value;
	}
	return 1;
}

function durationParam(params: Record<string, unknown>): number | undefined {
	for (const key of ['duration', 'durationSeconds', 'length', 'seconds', 'videoLength', 'videoDuration']) {
		const value = Number(params[key]);
		if (Number.isFinite(value) && value > 0) return value;
	}
	return undefined;
}

function seconds(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function runTimeQuote(estimate: number | undefined): PriceQuote {
	return estimate !== undefined && estimate > 0
		? { amount: estimate, approximate: true, label: `about ${formatUsd(estimate)}`, note: 'Billed by run time; this is the average of past runs.' }
		: { approximate: true, label: 'by run time', note: RUN_TIME };
}

/** One line for a dialog: "$0.034 per run.", "about $0.013. Billed by run time; …". */
export function priceLine(price: PriceQuote): string {
	if (!price.note) return price.label;
	return price.note.toLowerCase().startsWith(price.label.toLowerCase()) ? price.note : `${price.label}. ${price.note}`;
}

function rowQuote(row: PriceRow, params: Record<string, unknown>, context: QuoteContext, estimate: number | undefined): PriceQuote {
	const price = Number(row.price) || 0;
	const note = row.note;
	const say = (sentence: string): string => note ?? sentence;

	switch (row.priceMethod) {
		case 'cpr':
			if (price === 0) return { amount: 0, approximate: false, label: 'Free', note: say('Free to run right now.') };
			return { amount: price, approximate: false, label: formatUsd(price), note: say(`${formatUsd(price)} per run.`) };
		case 'cpo': {
			if (price === 0) return { amount: 0, approximate: false, label: 'Free', note: say('Free to run right now.') };
			const count = countParam(params);
			const amount = price * count;
			return {
				amount,
				approximate: false,
				label: formatUsd(amount),
				note: say(count > 1 ? `${formatUsd(price)} per output, ${formatUsd(amount)} for ${count} outputs.` : `${formatUsd(price)} per output.`),
			};
		}
		case 'cp-promptlength': {
			const chars = context.promptChars ?? 0;
			if (chars === 0) return { approximate: true, label: `${formatUsd(price)} / character`, note: say(`${formatUsd(price)} per character of text.`) };
			const amount = price * chars;
			return { amount, approximate: false, label: formatUsd(amount), note: say(`${formatUsd(amount)} for ${chars.toLocaleString('en-US')} characters.`) };
		}
		case 'cp-audiosecondslength': {
			const length = context.mediaSeconds;
			if (length === undefined) return { approximate: true, label: `${formatUsd(price)} / audio second`, note: say(`${formatUsd(price)} per second of audio.`) };
			const amount = price * length;
			return { amount, approximate: true, label: `about ${formatUsd(amount)}`, note: say(`About ${formatUsd(amount)} for ${seconds(length)} seconds of audio.`) };
		}
		case 'cp-outputVideoLength': {
			const length = durationParam(params);
			if (length === undefined) return { approximate: true, label: `${formatUsd(price)} / video second`, note: say(`${formatUsd(price)} per second of video.`) };
			const amount = price * length;
			return { amount, approximate: false, label: formatUsd(amount), note: say(`${formatUsd(amount)} for ${seconds(length)} seconds of video.`) };
		}
		case 'cp-pixel':
			return { amount: price, approximate: true, label: `from ${formatUsd(price)}`, note: say(`${formatUsd(price)} for an image up to 1024 x 1024 pixels, more for larger ones.`) };
		case 'cps':
			return { approximate: true, label: `${formatUsd(price)} / second`, note: say(`${formatUsd(price)} per second of run time.`) };
		case 'cpt':
			return { approximate: true, label: 'by tokens', note: say(`${formatUsd(price)} per token. The total is known when the run ends.`) };
		case 'cp-readoutput':
			return price > 0
				? { amount: price, approximate: true, label: `about ${formatUsd(price)}`, note: say('The exact charge shows when the run ends.') }
				: { approximate: true, label: 'set when it ends', note: say('The exact charge shows when the run ends.') };
		case 'cp-realtimeturn':
			return { approximate: true, label: 'per turn', note: say('Billed turn by turn during a live session.') };
		default:
			return runTimeQuote(estimate);
	}
}

function scaleRow(row: PriceRow, scale: number): PriceRow {
	if (scale === 1) return row;
	const times = (value: number | undefined): number | undefined => (value === undefined ? undefined : value * scale);
	return { ...row, price: row.price * scale, priceExtra: times(row.priceExtra), priceInput: times(row.priceInput) };
}

/** The price of a run with these parameters, after the caller's discount. */
export function quote(pricing: ModelPricing | undefined, params: Record<string, unknown>, context: QuoteContext = {}): PriceQuote {
	const rows = pricing?.rows ?? [];
	const discount = pricing?.discountPercent;
	const scale = discount !== undefined && discount > 0 && discount <= 100 ? 1 - discount / 100 : 1;
	const estimate = pricing?.estimatedUsd !== undefined ? pricing.estimatedUsd * scale : undefined;
	if (rows.length === 0) return runTimeQuote(estimate);
	const live = rows.find((row) => row.priceMethod === 'cp-realtimeturn');
	if (live) return rowQuote(live, params, context, estimate);
	const row = matchingRow(rows, params);
	return row ? rowQuote(scaleRow(row, scale), params, context, estimate) : runTimeQuote(estimate);
}

/** A short price for a list row: the lowest price of the model and its unit. */
export function shortPrice(pricing: ModelPricing | undefined): string {
	const rows = pricing?.rows ?? [];
	if (rows.length === 0) return pricing?.estimatedUsd ? `about ${formatUsd(pricing.estimatedUsd)}` : 'by run time';
	const units: Record<string, string> = {
		cpr: '',
		cpo: ' / output',
		'cp-promptlength': ' / character',
		'cp-audiosecondslength': ' / audio second',
		'cp-outputVideoLength': ' / video second',
		cps: ' / second',
		cpt: ' / token',
	};
	const method = rows[0]?.priceMethod ?? '';
	if (method === 'cp-readoutput' || method === 'cp-realtimeturn') return 'set when it ends';
	if (method === 'cp-pixel') return `from ${formatUsd(Math.min(...rows.map((row) => row.price)))}`;
	const prices = rows.filter((row) => row.priceMethod === method).map((row) => row.price);
	const low = Math.min(...prices);
	const high = Math.max(...prices);
	if (high === 0) return 'Free';
	const unit = units[method] ?? '';
	return `${low === high ? '' : 'from '}${formatUsd(low)}${unit}`;
}
