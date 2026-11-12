import { Notice, TFile, type Editor } from 'obsidian';
import { FEATURES, selectedModel, type FeatureId } from '../catalog';
import { runMediaJob, type JobHost, type Target } from '../runner';
import { markdownToSpeechText } from '../text/speech-text';
import { EmbedPicker, type EmbedChoice } from '../ui/pickers';
import { RunDialog } from '../ui/run-dialog';
import { embedFits, findEmbeds } from '../vault/embeds';
import type { MediaKind } from '../vault/files';
import { quote } from '../wiro/pricing';
import { composeRunParams } from '../wiro/schema';

/** What the media commands need from the plugin. */
export interface MediaHost extends JobHost {
	saveSettings(): Promise<void>;
}

function saveOption(host: MediaHost, slug: string, param: string, value: string): void {
	host.settings.modelOptions[slug] = { ...host.settings.modelOptions[slug], [param]: value };
	void host.saveSettings();
}

/** The price of a run with the saved options, for commands that run without the dialog. */
function priceLabel(host: MediaHost, feature: FeatureId, slug: string, text: string | null, mediaSeconds?: number): string | undefined {
	const schema = host.schemas.peek(slug);
	if (!schema) return undefined;
	const params = composeRunParams(schema, { text, options: host.settings.modelOptions[slug] ?? {} });
	const result = quote(schema.pricing, params, { promptChars: text?.length ?? 0, mediaSeconds });
	return result.label === 'by run time' ? undefined : result.label;
}

interface StartOptions {
	feature: FeatureId;
	title: string;
	submitText: string;
	placeholder: string;
	initialText: string;
	target: Target;
	inputFile?: TFile;
	mediaSeconds?: number;
	/** Run right away (when the settings allow it) instead of showing the dialog. */
	quick?: boolean;
}

/** Shows the run dialog with the price, or runs right away for quick commands when the settings allow it. */
function start(host: MediaHost, options: StartOptions): void {
	const feature = FEATURES[options.feature];
	const model = selectedModel(host.settings, options.feature);
	if (!model.slug) {
		new Notice(`Choose a model for ${feature.name.toLowerCase()} in the plugin settings first.`);
		return;
	}
	const slug = model.slug;
	if (options.quick && !host.settings.confirmRuns) {
		const text = feature.takesText ? options.initialText : null;
		const spoken = options.feature === 'speech' && text !== null && host.settings.speechPlainText ? markdownToSpeechText(text) : text;
		void runMediaJob(host, {
			feature: options.feature,
			text,
			inputFile: options.inputFile,
			target: options.target,
			priceLabel: priceLabel(host, options.feature, slug, spoken, options.mediaSeconds),
		});
		return;
	}
	new RunDialog(
		host.app,
		host.settings,
		host.schemas,
		{
			feature: options.feature,
			title: options.title,
			initialText: options.initialText,
			placeholder: options.placeholder,
			submitText: options.submitText,
			modelName: model.name,
			slug,
			preview: options.inputFile,
			mediaSeconds: options.mediaSeconds,
			focusButton: options.quick,
			onSubmit: (text, price) => {
				void runMediaJob(host, {
					feature: options.feature,
					text: feature.takesText ? text : null,
					inputFile: options.inputFile,
					target: options.target,
					priceLabel: price && price.label !== 'by run time' ? price.label : undefined,
				});
			},
		},
		(modelSlug, param, value) => saveOption(host, modelSlug, param, value),
	).open();
}

/** The embeds of a kind in the note, resolved to vault files. */
function embedsOf(host: MediaHost, editor: Editor, file: TFile, kind: MediaKind): EmbedChoice[] {
	const choices: EmbedChoice[] = [];
	for (const embed of findEmbeds(editor.getValue())) {
		if (!embedFits(embed, kind)) continue;
		const target = host.app.metadataCache.getFirstLinkpathDest(embed.target, file.path);
		if (target instanceof TFile) choices.push({ file: target, line: embed.line });
	}
	return choices;
}

/** Runs `then` with the embed on the cursor's line, the only embed, or one the user picks. */
function withEmbed(host: MediaHost, editor: Editor, file: TFile, kind: MediaKind, then: (choice: EmbedChoice) => void): void {
	const choices = embedsOf(host, editor, file, kind);
	if (choices.length === 0) {
		new Notice(kind === 'image' ? 'This note has no embedded images.' : 'This note has no embedded audio files.');
		return;
	}
	const line = editor.getCursor().line;
	const here = choices.find((choice) => choice.line === line);
	if (here) then(here);
	else if (choices.length === 1 && choices[0]) then(choices[0]);
	else new EmbedPicker(host.app, choices, then).open();
}

/** The length of an audio file in seconds, read from its metadata. */
function audioSeconds(host: MediaHost, file: TFile): Promise<number | undefined> {
	return new Promise((resolve) => {
		const audio = createEl('audio');
		const timer = window.setTimeout(() => resolve(undefined), 5000);
		audio.preload = 'metadata';
		audio.addEventListener('loadedmetadata', () => {
			window.clearTimeout(timer);
			resolve(Number.isFinite(audio.duration) ? audio.duration : undefined);
		});
		audio.addEventListener('error', () => {
			window.clearTimeout(timer);
			resolve(undefined);
		});
		audio.src = host.app.vault.getResourcePath(file);
	});
}

function at(editor: Editor, file: TFile): Target {
	return { editor, file, at: editor.getCursor('to') };
}

export function generateImage(host: MediaHost, editor: Editor, file: TFile, fromSelection: boolean): void {
	start(host, {
		feature: 'image',
		title: 'Generate an image',
		submitText: 'Generate',
		placeholder: 'Describe the image',
		initialText: editor.getSelection(),
		target: at(editor, file),
		quick: fromSelection,
	});
}

export function editImage(host: MediaHost, editor: Editor, file: TFile): void {
	withEmbed(host, editor, file, 'image', (choice) => {
		start(host, {
			feature: 'edit',
			title: 'Edit the image',
			submitText: 'Edit',
			placeholder: 'What should change? For example: make it a watercolor painting',
			initialText: '',
			target: { editor, file, at: { line: choice.line, ch: 0 } },
			inputFile: choice.file,
		});
	});
}

export function upscaleImage(host: MediaHost, editor: Editor, file: TFile): void {
	withEmbed(host, editor, file, 'image', (choice) => {
		start(host, {
			feature: 'upscale',
			title: 'Upscale the image',
			submitText: 'Upscale',
			placeholder: '',
			initialText: '',
			target: { editor, file, at: { line: choice.line, ch: 0 } },
			inputFile: choice.file,
			quick: true,
		});
	});
}

export function generateVideo(host: MediaHost, editor: Editor, file: TFile): void {
	start(host, {
		feature: 'video',
		title: 'Generate a video',
		submitText: 'Generate',
		placeholder: 'Describe the video: the scene, the motion and the camera',
		initialText: editor.getSelection(),
		target: at(editor, file),
	});
}

export function generateSpeech(host: MediaHost, editor: Editor, file: TFile, fromSelection: boolean): void {
	start(host, {
		feature: 'speech',
		title: 'Generate speech',
		submitText: 'Generate',
		placeholder: 'Text to read aloud',
		initialText: editor.getSelection(),
		target: at(editor, file),
		quick: fromSelection,
	});
}

export function readNoteAloud(host: MediaHost, editor: Editor, file: TFile): void {
	const body = editor.getValue().replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '').trim();
	if (!body) {
		new Notice('This note is empty.');
		return;
	}
	start(host, {
		feature: 'speech',
		title: 'Read the note aloud',
		submitText: 'Generate',
		placeholder: 'Text to read aloud',
		initialText: body,
		target: { editor, file, top: true },
		quick: true,
	});
}

export function generateMusic(host: MediaHost, editor: Editor, file: TFile): void {
	start(host, {
		feature: 'music',
		title: 'Generate music',
		submitText: 'Generate',
		placeholder: 'Describe the music: genre, instruments, mood and tempo',
		initialText: editor.getSelection(),
		target: at(editor, file),
	});
}

export function transcribeAudio(host: MediaHost, editor: Editor, file: TFile): void {
	withEmbed(host, editor, file, 'audio', (choice) => {
		void audioSeconds(host, choice.file).then((seconds) => {
			start(host, {
				feature: 'transcribe',
				title: 'Transcribe the audio',
				submitText: 'Transcribe',
				placeholder: '',
				initialText: '',
				target: { editor, file, at: { line: choice.line, ch: 0 } },
				inputFile: choice.file,
				mediaSeconds: seconds,
				quick: true,
			});
		});
	});
}
