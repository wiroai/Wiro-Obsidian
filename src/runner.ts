import { Notice, type App, type Editor, type EditorPosition, type TFile } from 'obsidian';
import { FEATURES, selectedModel, type FeatureId } from './catalog';
import type { SchemaCache } from './schema-cache';
import { folderFor, type HistoryEntry, type TranscriptStyle, type WiroSettings } from './settings';
import { markdownToSpeechText } from './text/speech-text';
import { ProgressNotice } from './ui/progress-notice';
import { fileStamp, isTextOutput, isWiroFileUrl, mimeType, outputExtension, outputFileName, outputKind, uploadName, type MediaKind } from './vault/files';
import { Placeholder } from './vault/placeholder';
import { embedFor, saveAttachment } from './vault/save';
import type { Credentials } from './wiro/auth';
import type { TaskOutput, WiroClient } from './wiro/client';
import { errorMessage, TaskCancelledError } from './wiro/errors';
import type { HttpClient } from './wiro/http';
import { answerText, transcriptText } from './wiro/outputs';
import { composeRunParams, parseExtraParams, type ModelSchema } from './wiro/schema';
import { fileSlot } from './wiro/slots';
import { formatCost, runTask, type FinishedTask } from './wiro/task';

/** What a run needs from the plugin. */
export interface JobHost {
	app: App;
	settings: WiroSettings;
	schemas: SchemaCache;
	http: HttpClient;
	credentials(): Credentials | null;
	client(credentials: Credentials): WiroClient;
	/** Registers a running job so unloading the plugin can stop waiting for it. */
	trackJob(controller: AbortController): () => void;
	/** True while the plugin unloads: the task is left to finish on Wiro AI. */
	isUnloading(): boolean;
	addHistory(entry: HistoryEntry): Promise<void>;
}

/** Where a result goes in the note. */
export type Target = { editor: Editor; file: TFile } & ({ at: EditorPosition } | { top: true });

export interface MediaRunRequest {
	feature: FeatureId;
	/** The prompt or text, or null for models that take none. */
	text: string | null;
	/** A vault file for the model's file input (the image to edit, the audio to transcribe). */
	inputFile?: TFile;
	/** Values picked in the run dialog, by parameter id. */
	values?: Record<string, unknown>;
	target: Target;
	/** The price line shown in the progress notice. */
	priceLabel?: string;
}

const MAX_TEXT_OUTPUT_BYTES = 2_000_000;

/** Uploads a vault file to the project's Wiro storage and returns its URL. */
export async function uploadVaultFile(host: JobHost, client: WiroClient, file: TFile, kind?: MediaKind): Promise<string> {
	const data = await host.app.vault.readBinary(file);
	// A .webm voice recording is audio, though the extension alone says video.
	const type = kind === 'audio' && file.extension.toLowerCase() === 'webm' ? 'audio/webm' : mimeType(file.extension);
	return client.upload(uploadName(file.name), type, data);
}

/** Downloads output files of the wanted kinds and saves them in the vault. */
export async function saveOutputs(
	host: JobHost,
	outputs: { url: string; name?: string; contentType?: string }[],
	label: string,
	note: TFile,
	kinds: MediaKind[],
): Promise<TFile[]> {
	const stamp = fileStamp();
	const files: TFile[] = [];
	let index = 0;
	for (const output of outputs) {
		const asTask: TaskOutput = { url: output.url, name: output.name ?? '', contentType: output.contentType ?? '' };
		const kind = outputKind(asTask);
		if (!kind || !kinds.includes(kind)) continue;
		const extension = outputExtension(asTask, kind);
		if (!extension) continue;
		if (!isWiroFileUrl(output.url)) {
			throw new Error(`The model returned a file outside wiro.ai, which this plugin does not download: ${output.url}`);
		}
		const response = await host.http({ url: output.url, method: 'GET' });
		if (response.status !== 200) throw new Error(`Could not download a result file (HTTP ${response.status}).`);
		const name = outputFileName(label, stamp, index, extension);
		files.push(await saveAttachment(host.app, response.arrayBuffer(), name, folderFor(host.settings, kind), note.path));
		index += 1;
	}
	return files;
}

/** The text a task returned: its answer, else the contents of its text files. */
export async function taskText(host: JobHost, task: Pick<FinishedTask, 'outputs' | 'debugOutput'>): Promise<string> {
	const answer = answerText(task);
	if (answer) return answer;
	const parts: string[] = [];
	for (const output of task.outputs) {
		if (!output.url || !isTextOutput(output) || !isWiroFileUrl(output.url)) continue;
		if (typeof output.size === 'number' && output.size > MAX_TEXT_OUTPUT_BYTES) continue;
		const response = await host.http({ url: output.url, method: 'GET' });
		if (response.status === 200) parts.push(transcriptText(response.text()));
	}
	// answerText already falls back to debugoutput for tasks without files; for
	// tasks with files it holds run logs, not an answer.
	return parts.filter(Boolean).join('\n\n');
}

/** A transcript in the style the settings pick. */
export function formatTranscript(text: string, style: TranscriptStyle): string {
	const lines = text.trim().split('\n');
	if (style === 'paragraph') return text.trim();
	const quoted = lines.map((line) => (line ? `> ${line}` : '>')).join('\n');
	return style === 'quote' ? quoted : `> [!quote] Transcript\n${quoted}`;
}

export function insertPlaceholder(host: JobHost, target: Target, label: string): Placeholder {
	return 'top' in target
		? Placeholder.insertAtTop(host.app, target.editor, target.file, label)
		: Placeholder.insert(host.app, target.editor, target.file, target.at, label);
}

/** The feature's schema for a run, with the file input filled from an upload. */
async function inputFiles(
	host: JobHost,
	client: WiroClient,
	schema: ModelSchema | null,
	request: MediaRunRequest,
	progress: ProgressNotice,
): Promise<Record<string, string[]>> {
	const feature = FEATURES[request.feature];
	if (!request.inputFile || !feature.input) return {};
	const slot = schema ? fileSlot(schema, feature.input) : undefined;
	if (schema && !slot) throw new Error(`This model takes no ${feature.input} file. Pick another model in the plugin settings.`);
	progress.setPhase('uploading');
	const url = await uploadVaultFile(host, client, request.inputFile, feature.input);
	return { [slot?.param.id ?? (feature.input === 'audio' ? 'inputAudio' : 'inputImage')]: [url] };
}

/**
 * Runs a feature's model for a note: puts a placeholder where the result goes,
 * shows the progress, saves the result files (or text) and puts them in place
 * of the placeholder.
 */
export async function runMediaJob(host: JobHost, request: MediaRunRequest): Promise<void> {
	const feature = FEATURES[request.feature];
	const settings = host.settings;
	const credentials = host.credentials();
	if (!credentials) {
		new Notice('Add your Wiro AI API key in the plugin settings first.');
		return;
	}
	const model = selectedModel(settings, request.feature);
	if (!model.slug) {
		new Notice(`Choose a model for ${feature.name.toLowerCase()} in the plugin settings first.`);
		return;
	}
	let extra: Record<string, unknown>;
	try {
		extra = parseExtraParams(settings.features[request.feature].extraParams);
	} catch (error) {
		new Notice(errorMessage(error));
		return;
	}
	let text = request.text;
	if (text !== null) {
		text = request.feature === 'speech' && settings.speechPlainText ? markdownToSpeechText(text) : text.trim();
		if (!text) {
			new Notice(request.feature === 'speech' ? 'There is no text to read.' : 'Write a prompt first.');
			return;
		}
	}

	const slug = model.slug;
	const placeholder = insertPlaceholder(host, request.target, feature.verb.toLowerCase());
	const controller = new AbortController();
	const untrack = host.trackJob(controller);
	const title = `${feature.verb} with ${model.name}${request.priceLabel ? ` · ${request.priceLabel}` : ''}`;
	const progress = new ProgressNotice(title, () => controller.abort());

	try {
		const client = host.client(credentials);
		const schema = await host.schemas.forRun(slug);
		const files = await inputFiles(host, client, schema, request, progress);
		const params = composeRunParams(schema, {
			text: feature.takesText ? text : null,
			options: settings.modelOptions[slug] ?? {},
			extra,
			values: request.values,
			files,
		});
		const task = await runTask(client, slug, params, {
			signal: controller.signal,
			onPhase: (phase) => progress.setPhase(phase),
			shouldStop: () => !host.isUnloading(),
		});
		progress.setPhase('saving');

		let result: string;
		let saved: TFile[] = [];
		if (feature.output === 'text') {
			const transcript = await taskText(host, task);
			if (!transcript) throw new Error('The model finished, but returned no text.');
			result = formatTranscript(transcript, settings.transcriptStyle);
		} else {
			saved = await saveOutputs(host, task.outputs, feature.fileLabel, request.target.file, [feature.output]);
			if (saved.length === 0) {
				throw new Error(`The model finished, but returned no ${feature.output} file. Try another model in the plugin settings.`);
			}
			result = saved.map((file) => embedFor(host.app, file, request.target.file.path)).join('\n\n');
		}
		const placed = await placeholder.replace(result);
		progress.hide();

		const cost = Number(task.totalCost) > 0 ? formatCost(task.totalCost) : '';
		const what =
			feature.output === 'text' ? 'Transcript added.' : saved.length === 1 ? `Saved ${saved[0]?.path ?? ''}.` : `Saved ${saved.length} files.`;
		const where = placed ? '' : ' The placeholder was gone, so nothing was put in the note.';
		new Notice(`${what}${cost ? ` Cost: ${cost}.` : ''}${where}`, 8000);
		await host.addHistory({
			at: Date.now(),
			label: feature.name,
			model: slug,
			costUsd: Number(task.totalCost) || undefined,
			files: saved.map((file) => file.path),
			note: request.target.file.path,
			taskId: task.taskId,
		});
	} catch (error) {
		progress.hide();
		if (host.isUnloading()) return;
		await placeholder.remove();
		if (error instanceof TaskCancelledError) {
			new Notice(error.message === 'Cancelled.' ? 'Wiro AI run cancelled.' : error.message);
		} else {
			new Notice(`Wiro AI: ${errorMessage(error)}`, 12000);
		}
	} finally {
		untrack();
	}
}
