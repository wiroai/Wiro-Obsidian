import { Notice, type Editor, type TFile } from 'obsidian';
import { insertPlaceholder, saveOutputs, uploadVaultFile, type JobHost, type Target } from '../runner';
import { FormModal, type FieldKind, type FormField, type FormValues } from '../ui/form-modal';
import { WorkflowPicker } from '../ui/pickers';
import { ProgressNotice } from '../ui/progress-notice';
import { embedFor } from '../vault/save';
import type { WiroClient } from '../wiro/client';
import { errorMessage, TaskCancelledError, TaskTimeoutError } from '../wiro/errors';
import { formatUsd } from '../wiro/pricing';
import { sleep } from '../wiro/task';
import { RUN_FINAL_STATUSES, type WorkflowDetail, type WorkflowInput } from '../wiro/workflow';

/** Workflows run longer than single models. */
const WORKFLOW_TIMEOUT_MS = 45 * 60_000;

function inputField(input: WorkflowInput): FormField {
	const field: FormField = { key: input.key, label: input.label, kind: 'text', required: input.required };
	switch (input.kind) {
		case 'image':
		case 'audio':
		case 'video':
		case 'file':
			field.kind = 'file';
			field.fileKind = input.kind;
			break;
		default:
			field.kind = input.kind satisfies FieldKind;
	}
	if (input.options) field.options = input.options;
	const start = input.defaultValue;
	if (typeof start === 'string' || typeof start === 'number' || typeof start === 'boolean') field.defaultValue = String(start);
	if (input.description) field.description = input.description;
	return field;
}

async function runWorkflowJob(host: JobHost, client: WiroClient, detail: WorkflowDetail, form: FormValues, target: Target): Promise<void> {
	const placeholder = insertPlaceholder(host, target, `running ${detail.title}`);
	const controller = new AbortController();
	const untrack = host.trackJob(controller);
	const progress = new ProgressNotice(`Running the workflow ${detail.title}`, () => controller.abort());
	let started = false;
	try {
		const input: Record<string, unknown> = { ...form.values };
		for (const [key, files] of Object.entries(form.files)) {
			const first = files[0];
			if (!first) continue;
			progress.setPhase('uploading');
			const kind = detail.inputs.find((field) => field.key === key)?.kind;
			input[key] = await uploadVaultFile(host, client, first, kind === 'audio' ? 'audio' : undefined);
		}
		for (const [key, urls] of Object.entries(form.urls)) if (urls[0] && input[key] === undefined) input[key] = urls[0];

		progress.setPhase('starting');
		const token = await client.workflowRun(detail.fullSlug, input);
		started = true;
		const deadline = Date.now() + WORKFLOW_TIMEOUT_MS;
		let state = await client.workflowRunDetail(token);
		while (!RUN_FINAL_STATUSES.has(state.status)) {
			if (Date.now() > deadline) throw new TaskTimeoutError('The workflow did not finish in 45 minutes. It may still finish on Wiro AI.');
			progress.setDetail(state.totalSteps > 0 ? `Step ${Math.min(state.completedSteps + 1, state.totalSteps)} of ${state.totalSteps}` : 'Running');
			await sleep(4000, controller.signal);
			state = await client.workflowRunDetail(token);
		}
		if (state.status !== 'completed') {
			const reasons = state.failedSteps.map((step) => step.error ?? step.nodeId).filter(Boolean);
			throw new Error(`The workflow ${state.status}${reasons.length ? `: ${reasons.join('; ')}` : '.'}`);
		}

		progress.setPhase('saving');
		const parts: string[] = [];
		const savedPaths: string[] = [];
		for (const [field, items] of Object.entries(state.outputs)) {
			const files = await saveOutputs(
				host,
				items.filter((item) => item.url).map((item) => ({ url: item.url ?? '', name: item.name, contentType: item.mimeType })),
				'Wiro workflow',
				target.file,
				['image', 'video', 'audio'],
			);
			savedPaths.push(...files.map((file) => file.path));
			const texts = items.map((item) => item.text?.trim() ?? '').filter(Boolean);
			const urls = items.filter((item) => item.url && !files.length).map((item) => item.url ?? '');
			const block = [...files.map((file) => embedFor(host.app, file, target.file.path)), ...texts, ...urls].join('\n\n');
			if (block) parts.push(`**${field}**\n\n${block}`);
		}
		let placed = true;
		if (parts.length > 0) placed = await placeholder.replace(parts.join('\n\n'));
		else await placeholder.remove();
		progress.hide();
		const cost = state.chargedUsd !== undefined && state.chargedUsd > 0 ? formatUsd(state.chargedUsd) : '';
		const what = parts.length > 0 ? 'The workflow finished.' : 'The workflow finished without outputs.';
		new Notice(`${what}${cost ? ` Cost: ${cost}.` : ''}${placed ? '' : ' The placeholder was gone, so nothing was put in the note.'}`, 8000);
		await host.addHistory({
			at: Date.now(),
			label: `Workflow ${detail.title}`,
			model: detail.fullSlug,
			costUsd: state.chargedUsd,
			files: savedPaths,
			note: target.file.path,
		});
	} catch (error) {
		progress.hide();
		if (host.isUnloading()) return;
		await placeholder.remove();
		if (error instanceof TaskCancelledError) {
			new Notice(started ? 'Stopped waiting. The workflow keeps running on Wiro AI and its results stay in your dashboard.' : 'Wiro AI run cancelled.');
		} else {
			new Notice(`Wiro AI: ${errorMessage(error)}`, 12000);
		}
	} finally {
		untrack();
	}
}

async function openWorkflowForm(host: JobHost, client: WiroClient, fullSlug: string, editor: Editor, file: TFile): Promise<void> {
	let detail: WorkflowDetail;
	try {
		detail = await client.workflowDetail(fullSlug);
	} catch (error) {
		new Notice(`Wiro AI: ${errorMessage(error)}`);
		return;
	}
	const fields = detail.inputs.map(inputField);
	const firstText = fields.find((field) => field.kind === 'textarea' || field.kind === 'text');
	const selection = editor.getSelection();
	const target: Target = { editor, file, at: editor.getCursor('to') };
	const steps = `${detail.stepCount} ${detail.stepCount === 1 ? 'step' : 'steps'}`;
	new FormModal(host.app, {
		title: detail.title,
		description: [detail.description, `${detail.fullSlug} · ${steps} · Results go after the current line.`].filter(Boolean).join('\n\n'),
		fields,
		initial: firstText && selection ? { [firstText.key]: selection } : undefined,
		submitText: 'Run the workflow',
		price: () =>
			detail.estimatedUsd !== undefined
				? `Estimate: about ${formatUsd(detail.estimatedUsd)}. Each step is charged at its model's price when it ends.`
				: "Each step is charged at its model's price when it ends.",
		onSubmit: (form) => void runWorkflowJob(host, client, detail, form, target),
	}).open();
}

/** "Run a workflow": pick one of the project's workflows, or paste a link, then fill in its inputs. */
export function runWorkflow(host: JobHost, editor: Editor, file: TFile): void {
	const credentials = host.credentials();
	if (!credentials) {
		new Notice('Add your Wiro AI API key in the plugin settings first.');
		return;
	}
	const client = host.client(credentials);
	new WorkflowPicker(host.app, client, (workflow) => {
		void openWorkflowForm(host, client, workflow.fullSlug, editor, file);
	}).open();
}
