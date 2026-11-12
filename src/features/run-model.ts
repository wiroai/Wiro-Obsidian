import { Notice, type Editor, type TFile } from 'obsidian';
import { modelName } from '../catalog';
import { insertPlaceholder, saveOutputs, taskText, uploadVaultFile, type JobHost, type Target } from '../runner';
import { CatalogPicker, CategoryPicker } from '../ui/pickers';
import { FormModal, type FieldKind, type FormField, type FormValues } from '../ui/form-modal';
import { ProgressNotice } from '../ui/progress-notice';
import { embedFor } from '../vault/save';
import { WiroClient } from '../wiro/client';
import { errorMessage, TaskCancelledError } from '../wiro/errors';
import { priceLine, quote } from '../wiro/pricing';
import { composeRunParams, isFileParam, sentenceCaseLabel, textParamId, type ModelSchema, type ParamDef } from '../wiro/schema';
import { fileKind, slotsFor } from '../wiro/slots';
import { formatCost, runTask } from '../wiro/task';

function fieldKind(param: ParamDef): FieldKind {
	if (isFileParam(param)) return 'file';
	if (param.type === 'textarea') return 'textarea';
	if (param.type === 'select' && (param.options?.length ?? 0) > 0) return 'select';
	if (param.type === 'number' || param.type === 'float' || param.type === 'range') return 'number';
	if (param.type === 'checkbox') return 'toggle';
	return 'text';
}

/** The form fields for a model, leaving out URL twins of file fields. */
export function modelFields(schema: ModelSchema): FormField[] {
	const slots = slotsFor(schema);
	const shown = new Set([...slots.files.map((slot) => slot.param.id), ...Object.values(slots.named).map((param) => param.id), ...slots.rest.map((param) => param.id)]);
	const prompt = textParamId(schema);
	return schema.params
		.filter((param) => shown.has(param.id))
		.map((param) => {
			const kind = fieldKind(param);
			const field: FormField = {
				key: param.id,
				label: sentenceCaseLabel(param.label),
				kind,
				required: param.required,
				advanced: param.advanced && param.id !== prompt,
			};
			if (kind === 'file') {
				field.fileKind = fileKind(param);
				field.multiple = param.type !== 'fileinput';
			}
			if (param.options) field.options = param.options;
			if (param.defaultValue) field.defaultValue = param.defaultValue;
			if (param.note) field.description = param.note;
			if (param.min !== undefined) field.min = param.min;
			if (param.max !== undefined) field.max = param.max;
			if (param.step !== undefined) field.step = param.step;
			return field;
		});
}

/** File counts stand in for URLs when the price depends on how many files a run sends. */
function filePlaceholders(form: FormValues): Record<string, string[]> {
	const files: Record<string, string[]> = {};
	for (const key of new Set([...Object.keys(form.files), ...Object.keys(form.urls)])) {
		const count = (form.files[key]?.length ?? 0) + (form.urls[key]?.length ?? 0);
		if (count > 0) files[key] = Array.from({ length: count }, () => 'file');
	}
	return files;
}

async function runForm(host: JobHost, schema: ModelSchema, form: FormValues, target: Target, priceLabel?: string): Promise<void> {
	const credentials = host.credentials();
	if (!credentials) {
		new Notice('Add your Wiro AI API key in the plugin settings first.');
		return;
	}
	const name = modelName(schema.slug);
	const placeholder = insertPlaceholder(host, target, `running ${name}`);
	const controller = new AbortController();
	const untrack = host.trackJob(controller);
	const progress = new ProgressNotice(`Running ${name}${priceLabel ? ` · ${priceLabel}` : ''}`, () => controller.abort());
	try {
		const client = host.client(credentials);
		const files: Record<string, string[]> = {};
		for (const [key, chosen] of Object.entries(form.files)) {
			const param = schema.params.find((entry) => entry.id === key);
			const kind = param ? fileKind(param) : 'file';
			for (const file of chosen) {
				progress.setPhase('uploading');
				(files[key] ??= []).push(await uploadVaultFile(host, client, file, kind === 'audio' ? 'audio' : undefined));
			}
		}
		for (const [key, urls] of Object.entries(form.urls)) (files[key] ??= []).push(...urls);
		const params = composeRunParams(schema, { text: null, values: form.values, files });
		const task = await runTask(client, schema.slug, params, {
			signal: controller.signal,
			onPhase: (phase) => progress.setPhase(phase),
			shouldStop: () => !host.isUnloading(),
		});
		progress.setPhase('saving');
		const saved = await saveOutputs(host, task.outputs, 'Wiro output', target.file, ['image', 'video', 'audio']);
		const text = await taskText(host, task);
		const parts = [...saved.map((file) => embedFor(host.app, file, target.file.path))];
		if (text) parts.push(text);
		if (parts.length === 0) throw new Error('The model finished, but returned nothing to put in the note.');
		const placed = await placeholder.replace(parts.join('\n\n'));
		progress.hide();
		const cost = Number(task.totalCost) > 0 ? formatCost(task.totalCost) : '';
		new Notice(`${name} finished.${cost ? ` Cost: ${cost}.` : ''}${placed ? '' : ' The placeholder was gone, so nothing was put in the note.'}`, 8000);
		await host.addHistory({
			at: Date.now(),
			label: `Run ${name}`,
			model: schema.slug,
			costUsd: Number(task.totalCost) || undefined,
			files: saved.map((file) => file.path),
			note: target.file.path,
			taskId: task.taskId,
		});
	} catch (error) {
		progress.hide();
		if (host.isUnloading()) return;
		await placeholder.remove();
		if (error instanceof TaskCancelledError) new Notice(error.message === 'Cancelled.' ? 'Wiro AI run cancelled.' : error.message);
		else new Notice(`Wiro AI: ${errorMessage(error)}`, 12000);
	} finally {
		untrack();
	}
}

/** Opens the form for a model and runs it. */
export async function openModelForm(host: JobHost, slug: string, editor: Editor, file: TFile): Promise<void> {
	let schema: ModelSchema;
	try {
		schema = await host.schemas.load(slug);
	} catch (error) {
		new Notice(`Wiro AI: ${errorMessage(error)}`);
		return;
	}
	const fields = modelFields(schema);
	const prompt = textParamId(schema);
	const selection = editor.getSelection();
	const target: Target = { editor, file, at: editor.getCursor('to') };
	let current = '';
	new FormModal(host.app, {
		title: modelName(slug) === slug ? (schema.title ?? slug) : modelName(slug),
		description: `${slug} · Results go after the current line.`,
		fields,
		initial: selection && fields.some((field) => field.key === prompt) ? { [prompt]: selection } : undefined,
		submitText: 'Run',
		price: (form) => {
			const params = composeRunParams(schema, { text: null, values: form.values, files: filePlaceholders(form) });
			const promptValue = form.values[prompt];
			const result = quote(schema.pricing, params, { promptChars: typeof promptValue === 'string' ? promptValue.length : 0 });
			current = result.label === 'by run time' ? '' : result.label;
			return `Price: ${priceLine(result)}`;
		},
		onSubmit: (form) => void runForm(host, schema, form, target, current || undefined),
	}).open();
}

/** "Run a model": pick a kind of model, then a model from the catalog, then fill in its form. */
export function runAnyModel(host: JobHost, editor: Editor, file: TFile): void {
	const catalog = new WiroClient(host.http, null);
	new CategoryPicker(host.app, (category) => {
		new CatalogPicker(host.app, catalog, category.categories, (model) => {
			void openModelForm(host, model.slug, editor, file);
		}).open();
	}).open();
}
