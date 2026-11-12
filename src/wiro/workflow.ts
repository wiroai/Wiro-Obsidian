// Wiro workflows: the list, the inputs a run takes and the outputs of a
// finished run. The shapes follow the Wiro API as the Wiro MCP server reads it
// (Workflow/List, Workflow/Detail, Workflow/Run, Workflow/RunDetail).

export const WORKFLOW_PAGE = 'https://wiro.ai/workflows/';

/** Statuses that end a workflow run. */
export const RUN_FINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'stopped']);

export interface WorkflowSummary {
	fullSlug: string;
	title: string;
	description?: string;
	stepCount?: number;
}

export type WorkflowInputKind = 'text' | 'textarea' | 'image' | 'audio' | 'video' | 'file' | 'select' | 'number' | 'toggle';

export interface WorkflowInput {
	key: string;
	label: string;
	kind: WorkflowInputKind;
	required: boolean;
	defaultValue?: unknown;
	options?: { value: string; label: string }[];
	description?: string;
}

export interface WorkflowDetail {
	fullSlug: string;
	title: string;
	description?: string;
	inputs: WorkflowInput[];
	/** The workflow's estimate in USD, when Wiro gives one. */
	estimatedUsd?: number;
	stepCount: number;
}

export interface RunOutputItem {
	url?: string;
	name?: string;
	mimeType?: string;
	text?: string;
}

export interface WorkflowRunState {
	token: string;
	status: string;
	outputs: Record<string, RunOutputItem[]>;
	failedSteps: { nodeId: string; error?: string }[];
	completedSteps: number;
	totalSteps: number;
	chargedUsd?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	return '';
}

function asNumber(value: unknown): number | undefined {
	if (value === '' || value === null || value === undefined) return undefined;
	const number = Number(value);
	return Number.isFinite(number) ? number : undefined;
}

function parseJson(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value);
	} catch {
		return undefined;
	}
}

/**
 * Turns a workflow URL or slug into the full slug a run takes: "<name>-<5 character id>".
 * Returns null when it is neither.
 */
export function parseWorkflowSlug(input: string): string | null {
	let value = input.trim();
	if (/^https?:\/\//i.test(value)) {
		try {
			value = new URL(value).pathname.split('/').filter(Boolean).pop() ?? '';
		} catch {
			return null;
		}
	}
	value = decodeURIComponent(value.split(/[?#]/)[0] ?? '');
	const separator = value.lastIndexOf('-');
	const id = separator > 0 ? value.slice(separator + 1) : '';
	return separator > 0 && /^[A-Za-z0-9]{5}$/.test(id) && /^[a-z0-9-]+$/i.test(value) ? value : null;
}

function fullSlugOf(row: Record<string, unknown>): string {
	const slug = asString(row.slug);
	const id = asString(row.slugid);
	return id && !slug.endsWith(`-${id}`) ? `${slug}-${id}` : slug;
}

/** Rows of a Workflow/List answer. */
export function parseWorkflowList(data: unknown): WorkflowSummary[] {
	if (!isRecord(data) || !Array.isArray(data.workflow)) return [];
	const result: WorkflowSummary[] = [];
	for (const row of data.workflow as unknown[]) {
		if (!isRecord(row)) continue;
		const fullSlug = fullSlugOf(row);
		if (!fullSlug) continue;
		const summary: WorkflowSummary = { fullSlug, title: asString(row.title) || fullSlug };
		const description = asString(row.description).trim();
		if (description) summary.description = description;
		const steps = asNumber(row.stepcount);
		if (steps !== undefined) summary.stepCount = steps;
		result.push(summary);
	}
	return result;
}

function inputKind(type: string, field: string): WorkflowInputKind {
	const ui = field.toLowerCase();
	if (ui === 'image' || ui === 'audio' || ui === 'video' || ui === 'file') return ui;
	if (ui === 'textarea') return 'textarea';
	if (ui === 'select' || ui === 'dropdown') return 'select';
	if (ui === 'number' || type === 'number' || type === 'integer') return 'number';
	if (ui === 'toggle' || ui === 'checkbox' || type === 'boolean') return 'toggle';
	return 'text';
}

/** The detail of a workflow: its Start inputs, keyed exactly as Workflow/Run expects them. */
export function parseWorkflowDetail(data: unknown): WorkflowDetail | null {
	if (!isRecord(data) || !Array.isArray(data.workflow)) return null;
	const row: unknown = data.workflow[0];
	if (!isRecord(row)) return null;
	const contents = parseJson(row.contents);
	const contentsObject = isRecord(contents) ? contents : {};
	const schema = isRecord(contentsObject.schema) ? contentsObject.schema : {};
	const fields = isRecord(schema.input) ? schema.input : {};
	const required = Array.isArray(row.requiredinputs) ? new Set((row.requiredinputs as unknown[]).map(asString)) : null;
	const inputs: WorkflowInput[] = [];
	for (const [key, raw] of Object.entries(fields)) {
		const field = isRecord(raw) ? raw : {};
		const ui = isRecord(field.ui) ? field.ui : {};
		const input: WorkflowInput = {
			key,
			label: asString(field.label) || asString(field.name) || key,
			kind: inputKind(asString(field.type), asString(ui.field)),
			required: required ? required.has(key) : field.required === true,
		};
		if (Object.prototype.hasOwnProperty.call(field, 'defaultValue') && field.defaultValue !== '') input.defaultValue = field.defaultValue;
		if (Array.isArray(ui.options)) {
			input.options = (ui.options as unknown[])
				.filter(isRecord)
				.map((option) => ({ value: asString(option.value), label: asString(option.text) || asString(option.value) }));
		}
		const description = asString(field.description).trim();
		if (description && !/^an? \w+ field$/i.test(description)) input.description = description;
		inputs.push(input);
	}
	const nodes = isRecord(contentsObject.nodes) ? contentsObject.nodes : {};
	const estimated = isRecord(row.estimatedcost) ? asNumber(row.estimatedcost.value) : undefined;
	const detail: WorkflowDetail = {
		fullSlug: fullSlugOf(row),
		title: asString(row.title) || fullSlugOf(row),
		inputs,
		stepCount: Object.keys(nodes).filter((key) => key !== 'output').length || (asNumber(row.stepcount) ?? 0),
	};
	const description = asString(row.description).trim();
	if (description) detail.description = description;
	if (estimated !== undefined) detail.estimatedUsd = estimated;
	return detail;
}

function normalizeOutput(value: unknown, out: RunOutputItem[], depth = 0): void {
	if (depth > 6 || value === null || value === undefined) return;
	if (Array.isArray(value)) {
		for (const entry of value) normalizeOutput(entry, out, depth + 1);
		return;
	}
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (/^https:\/\/\S+$/i.test(trimmed)) out.push({ url: trimmed });
		else if (trimmed) out.push({ text: value });
		return;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		out.push({ text: String(value) });
		return;
	}
	if (!isRecord(value)) return;
	if (Array.isArray(value.children) && value.children.length > 0) {
		normalizeOutput(value.children, out, depth + 1);
		return;
	}
	if (value.contenttype === 'raw' && isRecord(value.content)) {
		const answer = value.content.answer;
		const text = Array.isArray(answer)
			? (answer as unknown[]).map((part) => (typeof part === 'string' ? part : isRecord(part) ? asString(part.text) : '')).join('')
			: asString(answer);
		if (text) out.push({ text });
		return;
	}
	const url = asString(value.url);
	if (url && /^https:\/\//i.test(url)) {
		const item: RunOutputItem = { url };
		const name = asString(value.name);
		if (name) item.name = name;
		const mimeType = asString(value.contenttype);
		if (mimeType) item.mimeType = mimeType;
		out.push(item);
	}
}

/**
 * Resolves the End node's fields against the run's step outputs:
 * "$node-X.outputs" is a model step's output list, "$node-X.<port>" a utility
 * port, "$input.<key>" the run's Start value, anything else a literal.
 */
export function resolveRunOutputs(contents: unknown, nodes: Record<string, unknown>[]): Record<string, RunOutputItem[]> {
	const contentsObject = isRecord(contents) ? contents : {};
	const nodeMap = isRecord(contentsObject.nodes) ? contentsObject.nodes : {};
	const end = isRecord(nodeMap.output) ? nodeMap.output : {};
	const fields = isRecord(end.fields) ? end.fields : {};
	const metadata = isRecord(contentsObject.metadata) ? contentsObject.metadata : {};
	const metadataInput = isRecord(metadata.input) ? metadata.input : {};
	const values = isRecord(metadataInput.values) ? metadataInput.values : {};
	const byId = new Map(nodes.map((node) => [asString(node.nodeId), node]));
	const outputs: Record<string, RunOutputItem[]> = {};
	for (const [field, reference] of Object.entries(fields)) {
		const items: RunOutputItem[] = [];
		for (const ref of Array.isArray(reference) ? (reference as unknown[]) : [reference]) {
			if (typeof ref !== 'string' || !ref.startsWith('$')) {
				normalizeOutput(ref, items);
				continue;
			}
			if (ref.startsWith('$input.')) {
				normalizeOutput(values[ref.slice('$input.'.length)], items);
				continue;
			}
			const match = /^\$(node-[^.]+)\.(.+)$/.exec(ref);
			const node = match ? byId.get(match[1] ?? '') : undefined;
			if (!match || !node || node.status !== 'completed') continue;
			const stepOutputs = node.outputs;
			if (match[2] === 'outputs' && Array.isArray(stepOutputs)) normalizeOutput(stepOutputs, items);
			else if (isRecord(stepOutputs)) normalizeOutput(stepOutputs[match[2] ?? ''], items);
		}
		outputs[field] = items;
	}
	return outputs;
}

/** The state of a run from a Workflow/RunDetail answer. */
export function parseRunDetail(data: unknown, token: string): WorkflowRunState {
	const record = isRecord(data) ? data : {};
	const run = isRecord(record.workflowrun) ? record.workflowrun : {};
	const nodes = Array.isArray(record.workflowrunnodes) ? (record.workflowrunnodes as unknown[]).filter(isRecord) : [];
	const status = asString(run.status) || 'running';
	const failedSteps: WorkflowRunState['failedSteps'] = [];
	let completedSteps = 0;
	for (const node of nodes) {
		const nodeStatus = asString(node.status);
		if (nodeStatus === 'completed') completedSteps += 1;
		else if (nodeStatus === 'failed') {
			const error = asString(node.error).trim();
			failedSteps.push({ nodeId: asString(node.nodeId), ...(error ? { error: error.slice(0, 400) } : {}) });
		}
	}
	const state: WorkflowRunState = {
		token: asString(run.workflowtoken) || token,
		status,
		outputs: RUN_FINAL_STATUSES.has(status) ? resolveRunOutputs(parseJson(run.contents), nodes) : {},
		failedSteps,
		completedSteps,
		totalSteps: nodes.length,
	};
	const charged = asNumber(run.chargedcost) ?? asNumber(run.totalcost);
	if (charged !== undefined) state.chargedUsd = charged;
	return state;
}
