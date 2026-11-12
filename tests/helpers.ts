import type { HttpClient, HttpRequest } from '../src/wiro/http';

export interface Recorded extends HttpRequest {
	route: string;
}

/** A fake HTTP layer that answers each route from a handler and records the requests. */
export function fakeHttp(
	handler: (request: Recorded) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>,
): { http: HttpClient; requests: Recorded[] } {
	const requests: Recorded[] = [];
	const http: HttpClient = async (request) => {
		const route = request.url.replace('https://api.wiro.ai/v1', '');
		const recorded = { ...request, route };
		requests.push(recorded);
		const answer = await handler(recorded);
		const text = typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body);
		return {
			status: answer.status ?? 200,
			text: () => text,
			arrayBuffer: () => new TextEncoder().encode(text).buffer,
		};
	};
	return { http, requests };
}

export const ok = (extra: Record<string, unknown> = {}) => ({ body: { result: true, errors: [], ...extra } });

export const refused = (message: string, code = 0, status = 200) => ({
	status,
	body: { result: false, errors: [{ time: 1, code, message }] },
});

/** A detail answer for one task. */
export function task(status: string, extra: Record<string, unknown> = {}) {
	return ok({ tasklist: [{ id: '42', status, pexit: '', outputs: [], ...extra }] });
}
