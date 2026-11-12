// The Wiro AI LLM gateway: an OpenAI-compatible Chat Completions endpoint at
// https://llm.wiro.ai/v1 (https://wiro.ai/docs/completions-api). The key goes
// in a Bearer header: "API_KEY", or "API_KEY:API_SECRET" for signature projects.

import type { Credentials } from './auth';
import { WiroApiError } from './errors';
import type { HttpClient } from './http';

export const GATEWAY = 'https://llm.wiro.ai/v1';

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface ChatResult {
	text: string;
	costUsd?: number;
	finishReason?: string;
}

export interface GatewayModel {
	id: string;
	name: string;
	contextLength?: number;
	/** USD per million tokens. */
	inputPerMillion?: number;
	outputPerMillion?: number;
}

/**
 * Sends a request and hands the response body to `onData` as it arrives.
 * Resolves with the status once the body ends. The plugin uses Node's https on
 * desktop, where Obsidian can stream; on mobile there is no transport and the
 * client falls back to one requestUrl call.
 */
export type StreamTransport = (
	request: { url: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
	onData: (chunk: string) => void,
) => Promise<{ status: number }>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function bearerToken(credentials: Credentials): string {
	return `Bearer ${credentials.apiSecret ? `${credentials.apiKey}:${credentials.apiSecret}` : credentials.apiKey}`;
}

/** Splits a growing SSE buffer into complete `data:` payloads and the unfinished rest. */
export function takeSseData(buffer: string): { data: string[]; rest: string } {
	const normalized = buffer.replace(/\r\n?/g, '\n');
	const blocks = normalized.split('\n\n');
	const rest = blocks.pop() ?? '';
	const data: string[] = [];
	for (const block of blocks) {
		const lines = block.split('\n').filter((line) => line.startsWith('data:'));
		if (lines.length === 0) continue;
		data.push(lines.map((line) => line.slice(5).replace(/^ /, '')).join('\n'));
	}
	return { data, rest };
}

interface Delta {
	text: string;
	costUsd?: number;
	finishReason?: string;
	error?: string;
}

/** Reads one streamed chunk (or a whole non-streamed answer) of Chat Completions. */
export function readChunk(payload: unknown): Delta {
	const delta: Delta = { text: '' };
	if (!isRecord(payload)) return delta;
	if (isRecord(payload.error)) {
		delta.error = typeof payload.error.message === 'string' ? payload.error.message : 'The model returned an error.';
		return delta;
	}
	const choices = Array.isArray(payload.choices) ? (payload.choices as unknown[]) : [];
	for (const choice of choices) {
		if (!isRecord(choice)) continue;
		const part = isRecord(choice.delta) ? choice.delta : isRecord(choice.message) ? choice.message : {};
		if (typeof part.content === 'string') delta.text += part.content;
		if (typeof choice.finish_reason === 'string') delta.finishReason = choice.finish_reason;
	}
	if (isRecord(payload.usage) && typeof payload.usage.cost === 'number') delta.costUsd = payload.usage.cost;
	return delta;
}

function errorFromBody(status: number, body: string): WiroApiError {
	let message = '';
	try {
		const parsed: unknown = JSON.parse(body);
		if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === 'string') message = parsed.error.message;
	} catch {
		// Not JSON.
	}
	if (status === 401 || status === 403) {
		return new WiroApiError('The API key was not accepted. Check the key in the plugin settings, and the API secret if the project uses signature-based authentication.', { status });
	}
	return new WiroApiError(message || `The LLM gateway answered HTTP ${status}.`, { status, retryable: status >= 500 || status === 429 });
}

export class GatewayClient {
	constructor(
		private readonly http: HttpClient,
		private readonly credentials: Credentials | null,
		private readonly transport: StreamTransport | null,
		private readonly baseUrl: string = GATEWAY,
	) {}

	/** The gateway's models with their token prices. Needs no key. */
	async models(): Promise<GatewayModel[]> {
		const response = await this.http({ url: `${this.baseUrl}/models`, method: 'GET', headers: { Accept: 'application/json' } });
		if (response.status !== 200) throw errorFromBody(response.status, response.text());
		const parsed: unknown = JSON.parse(response.text());
		const data = isRecord(parsed) && Array.isArray(parsed.data) ? (parsed.data as unknown[]) : [];
		const models: GatewayModel[] = [];
		for (const entry of data) {
			if (!isRecord(entry) || typeof entry.id !== 'string') continue;
			const pricing = isRecord(entry.pricing) ? entry.pricing : {};
			const perMillion = (value: unknown): number | undefined => {
				const number = Number(value);
				return Number.isFinite(number) && value !== undefined && value !== '' ? number * 1_000_000 : undefined;
			};
			models.push({
				id: entry.id,
				name: typeof entry.name === 'string' ? entry.name.replace(/^\(Wiro\)\s*/, '') : entry.id,
				contextLength: typeof entry.context_length === 'number' ? entry.context_length : undefined,
				inputPerMillion: perMillion(pricing.prompt),
				outputPerMillion: perMillion(pricing.completion),
			});
		}
		return models;
	}

	/**
	 * Runs a chat completion. With a transport the answer streams into `onText`
	 * piece by piece; without one it arrives in a single piece at the end.
	 */
	async chat(
		model: string,
		messages: ChatMessage[],
		options: { onText?: (text: string) => void; signal?: AbortSignal; maxTokens?: number } = {},
	): Promise<ChatResult> {
		if (!this.credentials?.apiKey) throw new WiroApiError('Add your Wiro AI API key in the plugin settings first.');
		const headers = {
			Authorization: bearerToken(this.credentials),
			'Content-Type': 'application/json',
			Accept: this.transport ? 'text/event-stream' : 'application/json',
		};
		const body: Record<string, unknown> = { model, messages };
		if (options.maxTokens) body.max_tokens = options.maxTokens;

		if (!this.transport) {
			const response = await this.http({ url: `${this.baseUrl}/chat/completions`, method: 'POST', headers, json: body });
			if (response.status !== 200) throw errorFromBody(response.status, response.text());
			let parsed: unknown;
			try {
				parsed = JSON.parse(response.text());
			} catch {
				throw new WiroApiError('The LLM gateway answered without JSON.');
			}
			const delta = readChunk(parsed);
			if (delta.error) throw new WiroApiError(delta.error);
			options.onText?.(delta.text);
			return { text: delta.text, costUsd: delta.costUsd, finishReason: delta.finishReason };
		}

		body.stream = true;
		body.stream_options = { include_usage: true };
		let buffer = '';
		let raw = '';
		const result: ChatResult = { text: '' };
		let streamError: string | undefined;
		const { status } = await this.transport(
			{ url: `${this.baseUrl}/chat/completions`, headers, body: JSON.stringify(body), signal: options.signal },
			(chunk) => {
				raw += chunk;
				buffer += chunk;
				const { data, rest } = takeSseData(buffer);
				buffer = rest;
				for (const payload of data) {
					if (payload === '[DONE]') continue;
					let parsed: unknown;
					try {
						parsed = JSON.parse(payload);
					} catch {
						continue;
					}
					const delta = readChunk(parsed);
					if (delta.error) streamError = delta.error;
					if (delta.text) {
						result.text += delta.text;
						options.onText?.(delta.text);
					}
					if (delta.costUsd !== undefined) result.costUsd = delta.costUsd;
					if (delta.finishReason) result.finishReason = delta.finishReason;
				}
			},
		);
		if (status !== 200) throw errorFromBody(status, raw);
		if (streamError) throw new WiroApiError(streamError);
		return result;
	}
}
