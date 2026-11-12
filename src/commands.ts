import type { Editor, MarkdownFileInfo, Menu, TFile } from 'obsidian';
import { selectedModel } from './catalog';
import { runJob } from './jobs';
import type WiroPlugin from './main';
import { PromptModal } from './ui/prompt-modal';
import type { MediaKind } from './vault/files';

function fromSelection(plugin: WiroPlugin, kind: MediaKind, editor: Editor, file: TFile): void {
	void runJob(plugin, { kind, text: editor.getSelection(), editor, file, at: editor.getCursor('to') });
}

function openPrompt(plugin: WiroPlugin, kind: MediaKind, editor: Editor, file: TFile): void {
	const model = selectedModel(plugin.settings, kind);
	const image = kind === 'image';
	new PromptModal(plugin.app, {
		title: image ? 'Generate an image' : 'Generate speech',
		placeholder: image ? 'Describe the image' : 'Text to read aloud',
		initialText: editor.getSelection(),
		submitText: 'Generate',
		note: `Model: ${model.name}. Change it in the Wiro AI settings.`,
		onSubmit: (text) => {
			// The modal took the focus, so read the position now.
			void runJob(plugin, { kind, text, editor, file, at: editor.getCursor('to') });
		},
	}).open();
}

export function registerCommands(plugin: WiroPlugin): void {
	plugin.addCommand({
		id: 'generate-image',
		name: 'Generate image',
		icon: 'image-plus',
		editorCheckCallback: (checking: boolean, editor: Editor, info: MarkdownFileInfo) => {
			if (!info.file) return false;
			if (!checking) openPrompt(plugin, 'image', editor, info.file);
			return true;
		},
	});

	plugin.addCommand({
		id: 'generate-image-from-selection',
		name: 'Generate image from selection',
		icon: 'image',
		editorCheckCallback: (checking: boolean, editor: Editor, info: MarkdownFileInfo) => {
			if (!info.file || !editor.getSelection().trim()) return false;
			if (!checking) fromSelection(plugin, 'image', editor, info.file);
			return true;
		},
	});

	plugin.addCommand({
		id: 'generate-speech',
		name: 'Generate speech',
		icon: 'audio-lines',
		editorCheckCallback: (checking: boolean, editor: Editor, info: MarkdownFileInfo) => {
			if (!info.file) return false;
			if (!checking) openPrompt(plugin, 'speech', editor, info.file);
			return true;
		},
	});

	plugin.addCommand({
		id: 'generate-speech-from-selection',
		name: 'Generate speech from selection',
		icon: 'volume-2',
		editorCheckCallback: (checking: boolean, editor: Editor, info: MarkdownFileInfo) => {
			if (!info.file || !editor.getSelection().trim()) return false;
			if (!checking) fromSelection(plugin, 'speech', editor, info.file);
			return true;
		},
	});

	plugin.registerEvent(
		plugin.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, info: MarkdownFileInfo) => {
			const file = info.file;
			if (!file || !editor.getSelection().trim()) return;
			menu.addItem((item) =>
				item
					.setTitle('Generate image with Wiro AI')
					.setIcon('image')
					.setSection('selection')
					.onClick(() => fromSelection(plugin, 'image', editor, file)),
			);
			menu.addItem((item) =>
				item
					.setTitle('Generate speech with Wiro AI')
					.setIcon('volume-2')
					.setSection('selection')
					.onClick(() => fromSelection(plugin, 'speech', editor, file)),
			);
		}),
	);
}
