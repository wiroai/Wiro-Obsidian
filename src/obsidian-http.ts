import { requestUrl } from 'obsidian';
import type { HttpClient } from './wiro/http';

/** The Wiro AI client's HTTP layer on top of Obsidian's requestUrl. */
export const obsidianHttp: HttpClient = async (request) => {
	const hasBody = request.json !== undefined;
	const response = await requestUrl({
		url: request.url,
		method: request.method,
		headers: request.headers,
		contentType: hasBody ? 'application/json' : undefined,
		body: hasBody ? JSON.stringify(request.json) : undefined,
		throw: false,
	});
	return {
		status: response.status,
		text: () => response.text,
		arrayBuffer: () => response.arrayBuffer,
	};
};
