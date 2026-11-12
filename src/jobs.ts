import { Notice, type App, type Editor, type EditorPosition, type TFile } from 'obsidian';
import { selectedModel } from './catalog';
import type { SchemaCache } from './schema-cache';
import { kindKeys, type WiroSettings } from './settings';
import { markdownToSpeechText } from './text/speech-text';
import { ProgressNotice } from './ui/progress-notice';
import { fileStamp, isWiroFileUrl, outputExtension, outputFileName, type MediaKind } from './vault/files';
import { Placeholder } from './vault/placeholder';
import { embedFor, saveAttachment } from './vault/save';
import type { Credentials } from './wiro/auth';
import type { TaskOutput, WiroClient } from './wiro/client';
import { errorMessage, TaskCancelledError } from './wiro/errors';
import type { HttpClient } from './wiro/http';
import { buildRunParams, parseExtraParams } from './wiro/schema';
import { formatCost, runTask, type FinishedTask } from './wiro/task';

/** What a job needs from the plugin. */
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
}

export interface JobRequest {
	kind: MediaKind;
	text: string;
	editor: Editor;
	file: TFile;
	/** The result goes after the line of this position. */
	at: EditorPosition;
}

const NOUN: Record<MediaKind, string> = { image: 'image', speech: 'audio file' };

/** Downloads the outputs of the right kind and saves them in the vault. */
async function saveOutputs(host: JobHost, task: FinishedTask, kind: MediaKind, note: TFile): Promise<TFile[]> {
	const wanted: { output: TaskOutput; extension: string }[] = [];
	for (const output of task.outputs) {
		const extension = outputExtension(output, kind);
		if (extension) wanted.push({ output, extension });
	}
	if (wanted.length === 0) {
		throw new Error(`The model finished, but returned no ${NOUN[kind]}. Try another model in the plugin settings.`);
	}

	const stamp = fileStamp();
	const folder = host.settings[kindKeys(kind).folder];
	const files: TFile[] = [];
	for (const [index, { output, extension }] of wanted.entries()) {
		if (!isWiroFileUrl(output.url)) {
			throw new Error(`The model returned a file outside wiro.ai, which this plugin does not download: ${output.url}`);
		}
		const response = await host.http({ url: output.url, method: 'GET' });
		if (response.status !== 200) {
			throw new Error(`Could not download the ${NOUN[kind]} (HTTP ${response.status}).`);
		}
		const name = outputFileName(kind, stamp, index, extension);
		files.push(await saveAttachment(host.app, response.arrayBuffer(), name, folder, note.path));
	}
	return files;
}

/**
 * Runs a model for the note: puts a placeholder where the result goes, shows
 * the progress, saves the result files and embeds them in place of the
 * placeholder.
 */
export async function runJob(host: JobHost, request: JobRequest): Promise<void> {
	const { kind, file } = request;
	const settings = host.settings;
	const credentials = host.credentials();
	if (!credentials) {
		new Notice('Add your Wiro AI API key in the plugin settings first.');
		return;
	}
	const model = selectedModel(settings, kind);
	if (!model.slug) {
		new Notice('Choose a model in the plugin settings first. Use the owner/model form for other models.');
		return;
	}
	let extra: Record<string, unknown>;
	try {
		extra = parseExtraParams(settings[kindKeys(kind).extraParams]);
	} catch (error) {
		new Notice(errorMessage(error));
		return;
	}
	const text = kind === 'speech' && settings.speechPlainText ? markdownToSpeechText(request.text) : request.text.trim();
	if (!text) {
		new Notice(kind === 'image' ? 'Write a prompt first.' : 'There is no text to read in the selection.');
		return;
	}

	const slug = model.slug;
	const placeholder = Placeholder.insert(host.app, request.editor, file, request.at, kind);
	const controller = new AbortController();
	const untrack = host.trackJob(controller);
	const verb = kind === 'image' ? 'Generating an image' : 'Generating speech';
	const progress = new ProgressNotice(`${verb} with ${model.name}`, () => controller.abort());

	try {
		const client = host.client(credentials);
		const schema = await host.schemas.forRun(slug);
		const params = buildRunParams(schema, text, settings.modelOptions[slug] ?? {}, extra);
		const task = await runTask(client, slug, params, {
			signal: controller.signal,
			onPhase: (phase) => progress.setPhase(phase),
			shouldStop: () => !host.isUnloading(),
		});
		progress.setPhase('saving');
		const saved = await saveOutputs(host, task, kind, file);
		const embeds = saved.map((savedFile) => embedFor(host.app, savedFile, file.path)).join('\n\n');
		const placed = await placeholder.replace(embeds);
		progress.hide();

		const cost = formatCost(task.totalCost);
		const what = saved.length === 1 ? `Saved ${saved[0]?.path ?? ''}.` : `Saved ${saved.length} files.`;
		const where = placed ? '' : ' The placeholder was gone, so nothing was embedded.';
		new Notice(`${what}${cost ? ` Cost: ${cost}.` : ''}${where}`, 8000);
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
