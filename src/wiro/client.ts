import { authHeaders, type Credentials } from './auth';
import { WiroApiError } from './errors';
import type { HttpClient, HttpRequest, HttpResponse } from './http';
import { buildMultipart } from './multipart';
import { parsePricing, parseToolDetail, type ModelPricing, type ModelSchema } from './schema';
import {
	parseRunDetail,
	parseWorkflowDetail,
	parseWorkflowList,
	type WorkflowDetail,
	type WorkflowRunState,
	type WorkflowSummary,
} from './workflow';

export const WIRO_API = 'https://api.wiro.ai/v1';

/** How long one API request may take before the plugin stops waiting for it. */
const REQUEST_TIMEOUT_MS = 60_000;

/** Uploads can be large and slow. */
const UPLOAD_TIMEOUT_MS = 300_000;

/** One output of a task: a file, or the structured answer of an LLM ("raw"). */
export interface TaskOutput {
	name: string;
	contentType: string;
	url: string;
	size?: number;
	/** The structured content of a "raw" output. */
	content?: unknown;
}

/** The parts of a Task/Detail answer the plugin reads (https://wiro.ai/docs/tasks). */
export interface TaskState {
	id: string;
	status: string;
	pexit: string;
	outputs: TaskOutput[];
	debugOutput: string;
	debugError: string;
	totalCost: string;
	elapsedSeconds: string;
}

export interface StartedTask {
	taskId: string;
	token: string;
}

/** A model in the public catalog, as Tool/List lists it. */
export interface CatalogEntry {
	slug: string;
	title: string;
	description?: string;
	categories: string[];
	pricing: ModelPricing;
}

/** A task of the project, as Task/List lists it. */
export interface TaskSummary {
	id: string;
	slug: string;
	status: string;
	pexit: string;
	totalCost: string;
	createdAt: number;
	outputs: TaskOutput[];
	debugOutput: string;
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

export function parseOutputs(value: unknown): TaskOutput[] {
	if (!Array.isArray(value)) return [];
	const outputs: TaskOutput[] = [];
	for (const item of value as unknown[]) {
		if (!isRecord(item)) continue;
		const url = asString(item.url);
		const contentType = asString(item.contenttype);
		if (!url && contentType !== 'raw') continue;
		const size = Number(item.size);
		const output: TaskOutput = { name: asString(item.name), contentType, url, size: Number.isFinite(size) ? size : undefined };
		if (contentType === 'raw') output.content = item.content;
		outputs.push(output);
	}
	return outputs;
}

/**
 * A small client for the Wiro AI Run API. Every call is a POST; success is
 * `result: true` and anything else becomes a WiroApiError.
 */
export class WiroClient {
	constructor(
		private readonly http: HttpClient,
		private readonly credentials: Credentials | null,
		private readonly baseUrl: string = WIRO_API,
	) {}

	private async send(
		route: string,
		request: Pick<HttpRequest, 'json' | 'body' | 'contentType'>,
		authenticated: boolean,
		timeoutMs = REQUEST_TIMEOUT_MS,
	): Promise<Record<string, unknown>> {
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
				this.http({ url: `${this.baseUrl}${route}`, method: 'POST', headers, ...request }),
				timeoutMs,
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

	private post(route: string, body: Record<string, unknown>, authenticated = true): Promise<Record<string, unknown>> {
		return this.send(route, { json: body }, authenticated);
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
			debugOutput: asString(task.debugoutput),
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

	/** The project's latest tasks: POST /Task/List. */
	async taskList(limit = 30): Promise<TaskSummary[]> {
		const data = await this.post('/Task/List', { limit: String(limit) });
		const rows = Array.isArray(data.tasklist) ? (data.tasklist as unknown[]) : [];
		const tasks: TaskSummary[] = [];
		for (const row of rows) {
			if (!isRecord(row)) continue;
			tasks.push({
				id: asString(row.id),
				slug: [asString(row.modelslugowner), asString(row.modelslugproject)].filter(Boolean).join('/'),
				status: asString(row.status),
				pexit: asString(row.pexit),
				totalCost: asString(row.totalcost),
				createdAt: Number(row.createtime) * 1000 || 0,
				outputs: parseOutputs(row.outputs),
				debugOutput: asString(row.debugoutput),
			});
		}
		return tasks;
	}

	/** Reads a model's parameters and prices from the public catalog: POST /Tool/Detail. Needs no key. */
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

	/** Models of the public catalog: POST /Tool/List. Needs no key. */
	async toolList(options: { categories?: string[]; search?: string; start?: number; limit?: number }): Promise<{ models: CatalogEntry[]; total: number }> {
		const body: Record<string, unknown> = {
			start: String(options.start ?? 0),
			limit: String(options.limit ?? 50),
			sort: 'relevance',
			order: 'DESC',
			hideworkflows: true,
			summary: true,
		};
		if (options.categories?.length) body.categories = options.categories;
		if (options.search) body.search = options.search;
		const data = await this.post('/Tool/List', body, false);
		const rows = Array.isArray(data.tool) ? (data.tool as unknown[]) : [];
		const models: CatalogEntry[] = [];
		for (const row of rows) {
			if (!isRecord(row)) continue;
			const owner = asString(row.cleanslugowner) || asString(row.slugowner);
			const project = asString(row.cleanslugproject) || asString(row.slugproject);
			if (!owner || !project) continue;
			const entry: CatalogEntry = {
				slug: `${owner}/${project}`,
				title: asString(row.title) || `${owner}/${project}`,
				categories: Array.isArray(row.categories) ? (row.categories as unknown[]).map(asString).filter(Boolean) : [],
				pricing: parsePricing(row),
			};
			const description = asString(row.description).trim();
			if (description) entry.description = description;
			models.push(entry);
		}
		return { models, total: Number(data.total) || models.length };
	}

	/** Uploads a file to the project's Wiro storage and returns its URL: POST /File/Upload. */
	async upload(fileName: string, contentType: string, data: ArrayBuffer): Promise<string> {
		const multipart = buildMultipart({}, [{ field: 'file', fileName, contentType, data }]);
		const result = await this.send('/File/Upload', { body: multipart.body, contentType: multipart.contentType }, true, UPLOAD_TIMEOUT_MS);
		const list = Array.isArray(result.list) ? (result.list as unknown[]) : [];
		const first = list.find(isRecord);
		const url = first ? asString(first.url) : '';
		if (!url) throw new WiroApiError(`Wiro AI stored ${fileName} without returning its URL.`);
		return url;
	}

	/** The project's workflows: POST /Workflow/List. */
	async workflowList(): Promise<WorkflowSummary[]> {
		const data = await this.post('/Workflow/List', { scope: 'my', order: 'DESC', sort: 'updatetime', start: '0', limit: '100' });
		return parseWorkflowList(data);
	}

	/** A workflow's inputs: POST /Workflow/Detail. */
	async workflowDetail(fullSlug: string): Promise<WorkflowDetail> {
		const detail = parseWorkflowDetail(await this.post('/Workflow/Detail', { slug: fullSlug }));
		if (!detail) throw new WiroApiError(`There is no workflow "${fullSlug}" that this project can open.`);
		return detail;
	}

	/** Starts a workflow run: POST /Workflow/Run. Returns the run token. */
	async workflowRun(fullSlug: string, input: Record<string, unknown>): Promise<string> {
		const body: Record<string, unknown> = { slug: fullSlug };
		if (Object.keys(input).length > 0) body.input = input;
		const data = await this.post('/Workflow/Run', body);
		const token = asString(data.workflowtoken);
		if (!token) throw new WiroApiError('The workflow started without a run token.');
		return token;
	}

	/** Reads a workflow run: POST /Workflow/RunDetail. */
	async workflowRunDetail(token: string): Promise<WorkflowRunState> {
		return parseRunDetail(await this.post('/Workflow/RunDetail', { workflowtoken: token }), token);
	}
}
