import { authHeaders, type Credentials } from './auth';
import { WiroApiError } from './errors';
import type { HttpClient, HttpResponse } from './http';
import { parseToolDetail, type ModelSchema } from './schema';

export const WIRO_API = 'https://api.wiro.ai/v1';

/** How long one API request may take before the plugin stops waiting for it. */
const REQUEST_TIMEOUT_MS = 60_000;

/** One output file of a task. */
export interface TaskOutput {
	name: string;
	contentType: string;
	url: string;
	size?: number;
}

/** The parts of a Task/Detail answer the plugin reads (https://wiro.ai/docs/tasks). */
export interface TaskState {
	id: string;
	status: string;
	pexit: string;
	outputs: TaskOutput[];
	debugError: string;
	totalCost: string;
	elapsedSeconds: string;
}

export interface StartedTask {
	taskId: string;
	token: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	return '';
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = window.setTimeout(() => reject(new WiroApiError(message, { retryable: true })), ms);
		promise.then(
			(value) => {
				window.clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				window.clearTimeout(timer);
				reject(error instanceof Error ? error : new Error(String(error)));
			},
		);
	});
}

function readErrors(data: Record<string, unknown>): { message: string; code?: number } {
	const errors = Array.isArray(data.errors) ? (data.errors as unknown[]) : [];
	const messages: string[] = [];
	let code: number | undefined;
	for (const error of errors) {
		if (typeof error === 'string') {
			messages.push(error);
		} else if (isRecord(error)) {
			const message = asString(error.message);
			if (message) messages.push(message);
			if (code === undefined && typeof error.code === 'number' && error.code !== 0) code = error.code;
		}
	}
	return { message: messages.join(' '), code };
}

function parseOutputs(value: unknown): TaskOutput[] {
	if (!Array.isArray(value)) return [];
	const outputs: TaskOutput[] = [];
	for (const item of value as unknown[]) {
		if (!isRecord(item)) continue;
		const url = asString(item.url);
		if (!url) continue;
		const size = Number(item.size);
		outputs.push({
			name: asString(item.name),
			contentType: asString(item.contenttype),
			url,
			size: Number.isFinite(size) ? size : undefined,
		});
	}
	return outputs;
}

/**
 * A small client for the Wiro AI Run API. Every call is a POST with a JSON
 * body; success is `result: true` and anything else becomes a WiroApiError.
 */
export class WiroClient {
	constructor(
		private readonly http: HttpClient,
		private readonly credentials: Credentials | null,
		private readonly baseUrl: string = WIRO_API,
	) {}

	private async post(route: string, body: Record<string, unknown>, authenticated = true): Promise<Record<string, unknown>> {
		const headers: Record<string, string> = { Accept: 'application/json' };
		if (authenticated) {
			if (!this.credentials?.apiKey) {
				throw new WiroApiError('Add your Wiro AI API key in the plugin settings first.');
			}
			Object.assign(headers, await authHeaders(this.credentials));
		}

		let response: HttpResponse;
		try {
			response = await withTimeout(
				this.http({ url: `${this.baseUrl}${route}`, method: 'POST', headers, json: body }),
				REQUEST_TIMEOUT_MS,
				`The request to ${route} timed out.`,
			);
		} catch (error) {
			if (error instanceof WiroApiError) throw error;
			throw new WiroApiError(`Could not reach api.wiro.ai (${error instanceof Error ? error.message : String(error)}).`, {
				retryable: true,
			});
		}

		let data: unknown;
		try {
			data = JSON.parse(response.text());
		} catch {
			throw new WiroApiError(`${route} answered HTTP ${response.status} without a JSON body.`, {
				status: response.status,
				retryable: response.status >= 500 || response.status === 429,
			});
		}
		if (!isRecord(data) || data.result !== true) {
			const { message, code } = isRecord(data) ? readErrors(data) : { message: '', code: undefined };
			throw new WiroApiError(message || `${route} answered HTTP ${response.status}.`, {
				code,
				status: response.status,
				retryable: response.status >= 500 || response.status === 429,
			});
		}
		return data;
	}

	/** Starts a task: POST /Run/{owner}/{project} (https://wiro.ai/docs/run-a-model). */
	async run(slug: string, params: Record<string, unknown>): Promise<StartedTask> {
		const [owner = '', project = ''] = slug.split('/');
		const data = await this.post(`/Run/${encodeURIComponent(owner)}/${encodeURIComponent(project)}`, params);
		const taskId = asString(data.taskid);
		const token = asString(data.socketaccesstoken);
		if (!taskId || !token) throw new WiroApiError('The run started without a task ID.');
		return { taskId, token };
	}

	/** Reads a task: POST /Task/Detail. Returns null while the task is not listed yet. */
	async taskDetail(token: string): Promise<TaskState | null> {
		const data = await this.post('/Task/Detail', { tasktoken: token });
		const task: unknown = Array.isArray(data.tasklist) ? (data.tasklist as unknown[])[0] : undefined;
		if (!isRecord(task)) return null;
		return {
			id: asString(task.id),
			status: asString(task.status),
			pexit: asString(task.pexit),
			outputs: parseOutputs(task.outputs),
			debugError: asString(task.debugerror),
			totalCost: asString(task.totalcost),
			elapsedSeconds: asString(task.elapsedseconds),
		};
	}

	/** Cancels a task that is still queued: POST /Task/Cancel. */
	async cancel(taskId: string): Promise<void> {
		await this.post('/Task/Cancel', { taskid: taskId });
	}

	/** Stops a running task: POST /Task/Kill. */
	async kill(token: string): Promise<void> {
		await this.post('/Task/Kill', { socketaccesstoken: token });
	}

	/** Checks the credentials with a free call that needs a valid key: POST /Task/List. */
	async checkKey(): Promise<void> {
		await this.post('/Task/List', { limit: '1' });
	}

	/** Reads a model's parameters from the public catalog: POST /Tool/Detail. Needs no key. */
	async toolDetail(slug: string): Promise<ModelSchema> {
		const [slugowner = '', slugproject = ''] = slug.split('/');
		const missing = `There is no public model "${slug}". Check the ID on wiro.ai/models.`;
		let data: Record<string, unknown>;
		try {
			data = await this.post('/Tool/Detail', { slugowner, slugproject }, false);
		} catch (error) {
			if (error instanceof WiroApiError && /tool-not-accessible|slug-owner-project-not-exist/.test(error.message)) {
				throw new WiroApiError(missing, { code: error.code, status: error.status });
			}
			throw error;
		}
		const schema = parseToolDetail(slug, data);
		if (!schema) throw new WiroApiError(missing);
		return schema;
	}
}
