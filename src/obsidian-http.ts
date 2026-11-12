import { requestUrl } from 'obsidian';
import type { HttpClient } from './wiro/http';

/** The Wiro AI clients' HTTP layer on top of Obsidian's requestUrl. */
export const obsidianHttp: HttpClient = async (request) => {
	let body: string | ArrayBuffer | undefined;
	let contentType: string | undefined;
	if (request.json !== undefined) {
		body = JSON.stringify(request.json);
		contentType = 'application/json';
	} else if (request.body !== undefined) {
		body = request.body;
		contentType = request.contentType;
	}
	const response = await requestUrl({
		url: request.url,
		method: request.method,
		headers: request.headers,
		contentType,
		body,
		throw: false,
	});
	return {
		status: response.status,
		text: () => response.text,
		arrayBuffer: () => response.arrayBuffer,
	};
};
