import type { Command, Editor, MarkdownFileInfo, MarkdownView, Menu, TFile } from 'obsidian';
import {
	editImage,
	generateImage,
	generateMusic,
	generateSpeech,
	generateVideo,
	readNoteAloud,
	transcribeAudio,
	upscaleImage,
} from './features/media';
import { runAnyModel } from './features/run-model';
import { askNote, continueWriting, rewrite, summarize, translate } from './features/text';
import { runWorkflow } from './features/workflow';
import type WiroPlugin from './main';

type EditorAction = (plugin: WiroPlugin, editor: Editor, file: TFile) => void;

/** A command that needs an open note, and a selection when `needsSelection` is set. */
function editorCommand(plugin: WiroPlugin, id: string, name: string, icon: string, run: EditorAction, needsSelection = false): Command {
	return {
		id,
		name,
		icon,
		editorCheckCallback: (checking: boolean, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
			const file = info.file;
			if (!file || (needsSelection && !editor.getSelection().trim())) return false;
			if (!checking) run(plugin, editor, file);
			return true;
		},
	};
}

export function registerCommands(plugin: WiroPlugin): void {
	const commands: Command[] = [
		editorCommand(plugin, 'generate-image', 'Generate image', 'image-plus', (p, e, f) => generateImage(p, e, f, false)),
		editorCommand(plugin, 'generate-image-from-selection', 'Generate image from selection', 'image', (p, e, f) => generateImage(p, e, f, true), true),
		editorCommand(plugin, 'edit-image', 'Edit image', 'wand-sparkles', editImage),
		editorCommand(plugin, 'upscale-image', 'Upscale image', 'scaling', upscaleImage),
		editorCommand(plugin, 'generate-video', 'Generate video', 'clapperboard', generateVideo),
		editorCommand(plugin, 'generate-speech', 'Generate speech', 'audio-lines', (p, e, f) => generateSpeech(p, e, f, false)),
		editorCommand(plugin, 'generate-speech-from-selection', 'Generate speech from selection', 'volume-2', (p, e, f) => generateSpeech(p, e, f, true), true),
		editorCommand(plugin, 'read-note-aloud', 'Read note aloud', 'headphones', readNoteAloud),
		editorCommand(plugin, 'transcribe-audio', 'Transcribe audio', 'captions', transcribeAudio),
		editorCommand(plugin, 'generate-music', 'Generate music', 'music', generateMusic),
		editorCommand(plugin, 'summarize', 'Summarize note or selection', 'list', summarize),
		editorCommand(plugin, 'rewrite-selection', 'Rewrite selection', 'pencil-line', rewrite, true),
		editorCommand(plugin, 'translate-selection', 'Translate selection', 'languages', translate, true),
		editorCommand(plugin, 'continue-writing', 'Continue writing', 'pen-line', continueWriting),
		editorCommand(plugin, 'ask-about-note', 'Ask about this note', 'message-circle-question', askNote),
		editorCommand(plugin, 'run-model', 'Run a model', 'boxes', runAnyModel),
		editorCommand(plugin, 'run-workflow', 'Run a workflow', 'workflow', runWorkflow),
		{
			id: 'open-history',
			name: 'Open history',
			icon: 'history',
			callback: () => void plugin.openHistory(),
		},
	];
	for (const command of commands) plugin.addCommand(command);

	plugin.registerEvent(
		plugin.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
			const file = info.file;
			if (!plugin.settings.editorMenu || !file || !editor.getSelection().trim()) return;
			const items: [string, string, EditorAction][] = [
				['Generate image with Wiro AI', 'image', (p, e, f) => generateImage(p, e, f, true)],
				['Generate speech with Wiro AI', 'volume-2', (p, e, f) => generateSpeech(p, e, f, true)],
				['Summarize with Wiro AI', 'list', summarize],
				['Rewrite with Wiro AI', 'pencil-line', rewrite],
				['Translate with Wiro AI', 'languages', translate],
			];
			for (const [title, icon, run] of items) {
				menu.addItem((item) =>
					item
						.setTitle(title)
						.setIcon(icon)
						.setSection('selection')
						.onClick(() => run(plugin, editor, file)),
				);
			}
		}),
	);
}
