import { MarkdownView, Notice, type Editor, type EditorPosition, type TFile } from 'obsidian';
import type { JobHost } from '../runner';
import { tail, textMessages, type TextAction as Action } from '../text/prompts';
import { LanguagePicker, QuestionModal } from '../ui/small-modals';
import { TextResultModal, type TextAction } from '../ui/text-modal';
import { planInsertion } from '../vault/placement';
import type { Credentials } from '../wiro/auth';
import type { GatewayClient, GatewayModel } from '../wiro/gateway';
import { formatUsd } from '../wiro/pricing';

/** What the text commands need from the plugin. */
export interface TextHost extends JobHost {
	gateway(credentials: Credentials): GatewayClient;
	/** The gateway's models, loaded once per session; empty until then. */
	gatewayModels(): Promise<GatewayModel[]>;
}

/** Context sent with "Continue writing" and the limit for whole notes. */
const CONTINUE_CONTEXT = 6000;
const NOTE_LIMIT = 120_000;

interface Range {
	from: EditorPosition;
	to: EditorPosition;
	text: string;
}

function selectionRange(editor: Editor): Range | null {
	const text = editor.getSelection();
	if (!text.trim()) return null;
	return { from: editor.getCursor('from'), to: editor.getCursor('to'), text };
}

/** The note without its front matter. */
function noteBody(editor: Editor): string {
	return editor.getValue().replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '').trim();
}

/** Puts text in its own paragraph after a line. */
export function insertBelow(editor: Editor, line: number, text: string): void {
	const lineCount = editor.lineCount();
	const at = Math.min(line, lineCount - 1);
	const plan = planInsertion(editor.getLine(at), at > 0 ? editor.getLine(at - 1) : null, at + 1 < lineCount ? editor.getLine(at + 1) : null, text);
	editor.replaceRange(plan.text, { line: at, ch: plan.ch });
}

/** Replaces the selected text, or puts the result below it if the note changed meanwhile. */
function replaceRange(editor: Editor, range: Range, text: string): void {
	if (editor.getRange(range.from, range.to) === range.text) {
		editor.replaceRange(text, range.from, range.to);
		return;
	}
	const offset = editor.getValue().indexOf(range.text);
	if (offset >= 0) {
		editor.replaceRange(text, editor.offsetToPos(offset), editor.offsetToPos(offset + range.text.length));
		return;
	}
	insertBelow(editor, range.to.line, text);
}

/**
 * The editor that shows `file`: the one the command ran in when it still does,
 * else another tab with the note open. Null when the note is not open.
 */
function editorFor(host: TextHost, file: TFile, preferred: Editor): Editor | null {
	let other: Editor | null = null;
	for (const leaf of host.app.workspace.getLeavesOfType('markdown')) {
		const view = leaf.view;
		if (!(view instanceof MarkdownView) || view.file?.path !== file.path) continue;
		if (view.editor === preferred) return preferred;
		other ??= view.editor;
	}
	return other;
}

/** Puts the result below a line of the note, in whichever tab shows it, or at the end of the file. */
function placeBelow(host: TextHost, file: TFile, preferred: Editor, line: number, text: string): void {
	const editor = editorFor(host, file, preferred);
	if (editor) {
		insertBelow(editor, editor === preferred ? line : editor.lastLine(), text);
		return;
	}
	void host.app.vault.process(file, (content) => `${content.replace(/\s+$/, '')}\n\n${text}\n`);
}

/** Replaces the selected text in whichever tab shows the note, or in the file itself. */
function placeInstead(host: TextHost, file: TFile, preferred: Editor, range: Range, text: string): void {
	const editor = editorFor(host, file, preferred);
	if (editor) {
		replaceRange(editor, range, text);
		return;
	}
	void host.app.vault.process(file, (content) => {
		const offset = content.indexOf(range.text);
		if (offset < 0) return `${content.replace(/\s+$/, '')}\n\n${text}\n`;
		return content.slice(0, offset) + text + content.slice(offset + range.text.length);
	});
}

async function subtitle(host: TextHost): Promise<string> {
	const id = host.settings.textModel;
	let models: GatewayModel[] = [];
	try {
		models = await host.gatewayModels();
	} catch {
		// The price line is optional.
	}
	const model = models.find((entry) => entry.id === id);
	if (!model) return `Model: ${id}`;
	const prices =
		model.inputPerMillion !== undefined && model.outputPerMillion !== undefined
			? ` · ${formatUsd(model.inputPerMillion)} input and ${formatUsd(model.outputPerMillion)} output per million tokens`
			: '';
	return `Model: ${model.name}${prices}`;
}

function openResult(host: TextHost, file: TFile, title: string, action: Action, text: string, extra: string, actions: TextAction[]): void {
	const credentials = host.credentials();
	if (!credentials) {
		new Notice('Add your Wiro AI API key in the plugin settings first.');
		return;
	}
	const gateway = host.gateway(credentials);
	void subtitle(host).then((line) => {
		const controllerUntrack: { untrack?: () => void } = {};
		new TextResultModal(host.app, {
			title,
			subtitle: line,
			sourcePath: file.path,
			run: (onText, signal) => {
				const controller = new AbortController();
				signal.addEventListener('abort', () => controller.abort(), { once: true });
				controllerUntrack.untrack = host.trackJob(controller);
				return gateway
					.chat(host.settings.textModel, textMessages(action, text, extra), { onText, signal: controller.signal })
					.finally(() => controllerUntrack.untrack?.());
			},
			actions,
			onDone: (result) => {
				void host.addHistory({ at: Date.now(), label: title, model: host.settings.textModel, costUsd: result.costUsd, files: [], note: file.path });
			},
		}).open();
	});
}

export function summarize(host: TextHost, editor: Editor, file: TFile): void {
	const range = selectionRange(editor);
	const text = range?.text ?? noteBody(editor);
	if (!text.trim()) {
		new Notice('There is nothing to summarize.');
		return;
	}
	const line = range ? range.to.line : editor.getCursor().line;
	openResult(host, file, range ? 'Summary of the selection' : 'Summary of the note', 'summarize', text.slice(0, NOTE_LIMIT), '', [
		{ label: 'Insert below', cta: true, run: (result) => placeBelow(host, file, editor, line, result) },
	]);
}

export function rewrite(host: TextHost, editor: Editor, file: TFile): void {
	const range = selectionRange(editor);
	if (!range) return;
	openResult(host, file, 'Rewrite', 'rewrite', range.text, '', [
		{ label: 'Replace the selection', cta: true, run: (result) => placeInstead(host, file, editor, range, result) },
		{ label: 'Insert below', run: (result) => placeBelow(host, file, editor, range.to.line, result) },
	]);
}

export function translate(host: TextHost, editor: Editor, file: TFile): void {
	const range = selectionRange(editor);
	if (!range) return;
	new LanguagePicker(host.app, host.settings.translateLanguage, (language) => {
		openResult(host, file, `Translate into ${language}`, 'translate', range.text, language, [
			{ label: 'Replace the selection', cta: true, run: (result) => placeInstead(host, file, editor, range, result) },
			{ label: 'Insert below', run: (result) => placeBelow(host, file, editor, range.to.line, result) },
		]);
	}).open();
}

export function continueWriting(host: TextHost, editor: Editor, file: TFile): void {
	const cursor = editor.getCursor('to');
	const before = editor.getRange({ line: 0, ch: 0 }, cursor);
	if (!before.trim()) {
		new Notice('Write a few words first, then continue from there.');
		return;
	}
	openResult(host, file, 'Continue writing', 'continue', tail(before, CONTINUE_CONTEXT), '', [
		{
			label: 'Insert at the cursor',
			cta: true,
			run: (result) => {
				const target = editorFor(host, file, editor);
				if (target !== editor) {
					placeBelow(host, file, editor, cursor.line, result);
					return;
				}
				const glue = /\s$/.test(before) ? '' : ' ';
				editor.replaceRange(`${glue}${result}`, cursor);
			},
		},
	]);
}

export function askNote(host: TextHost, editor: Editor, file: TFile): void {
	const note = noteBody(editor);
	if (!note) {
		new Notice('This note is empty.');
		return;
	}
	const line = editor.getCursor().line;
	new QuestionModal(host.app, {
		title: 'Ask about this note',
		placeholder: 'What would you like to know?',
		submitText: 'Ask',
		note: `The note (${note.length.toLocaleString('en-US')} characters) is sent with the question.`,
		onSubmit: (question) => {
			openResult(host, file, question.length > 60 ? `${question.slice(0, 57)}…` : question, 'ask', note.slice(0, NOTE_LIMIT), question, [
				{ label: 'Insert below', cta: true, run: (result) => placeBelow(host, file, editor, line, result) },
			]);
		},
	}).open();
}
