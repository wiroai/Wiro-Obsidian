/**
 * The HTTP layer the Wiro AI clients run on. The plugin passes in Obsidian's
 * `requestUrl`, which works on desktop and mobile and is not limited by CORS;
 * the tests pass in a fake.
 */
export interface HttpRequest {
	url: string;
	method: 'GET' | 'POST';
	headers?: Record<string, string>;
	/** A JSON body. Sent with `Content-Type: application/json`. */
	json?: unknown;
	/** A raw body, such as multipart form data, with its content type. */
	body?: ArrayBuffer;
	contentType?: string;
}

export interface HttpResponse {
	status: number;
	text(): string;
	arrayBuffer(): ArrayBuffer;
}

export type HttpClient = (request: HttpRequest) => Promise<HttpResponse>;
