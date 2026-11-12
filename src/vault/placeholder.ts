import { MarkdownView, type App, type Editor, type EditorPosition, type TFile } from 'obsidian';
import { placeholderText, planInsertion, topLine } from './placement';

/**
 * A comment that marks where a result will go while its task runs. It is an
 * Obsidian comment, so it shows in the editor and stays hidden in Reading
 * view. When the task ends it is replaced by the embeds, or removed.
 */
export class Placeholder {
	private constructor(
		private readonly app: App,
		private readonly file: TFile,
		readonly token: string,
		private readonly inserted: string,
	) {}

	/** Inserts the placeholder on its own line after the line at `at`. */
	static insert(app: App, editor: Editor, file: TFile, at: EditorPosition, label: string): Placeholder {
		const token = placeholderText(label);
		const lineCount = editor.lineCount();
		const plan = planInsertion(
			editor.getLine(at.line),
			at.line > 0 ? editor.getLine(at.line - 1) : null,
			at.line + 1 < lineCount ? editor.getLine(at.line + 1) : null,
			token,
		);
		editor.replaceRange(plan.text, { line: at.line, ch: plan.ch });
		return new Placeholder(app, file, token, plan.text);
	}

	/** Inserts the placeholder as the first block of the note, after any front matter. */
	static insertAtTop(app: App, editor: Editor, file: TFile, label: string): Placeholder {
		const token = placeholderText(label);
		const lines = editor.getValue().split('\n');
		const line = topLine(lines);
		const next = lines[line];
		const text = `${line > 0 ? '\n' : ''}${token}${next !== undefined && next.trim() !== '' ? '\n\n' : '\n'}`;
		editor.replaceRange(text, { line, ch: 0 });
		return new Placeholder(app, file, token, text);
	}

	/** The editor that has the note open, if any. */
	private openEditor(): Editor | null {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === this.file.path) return view.editor;
		}
		return null;
	}

	/** Replaces `search` with `replacement`. Returns false when `search` is gone. */
	private async swap(search: string, replacement: string): Promise<boolean> {
		const editor = this.openEditor();
		if (editor) {
			const offset = editor.getValue().indexOf(search);
			if (offset < 0) return false;
			editor.replaceRange(replacement, editor.offsetToPos(offset), editor.offsetToPos(offset + search.length));
			return true;
		}
		let found = false;
		await this.app.vault.process(this.file, (content) => {
			const offset = content.indexOf(search);
			if (offset < 0) return content;
			found = true;
			return content.slice(0, offset) + replacement + content.slice(offset + search.length);
		});
		return found;
	}

	/** Puts the result in place of the placeholder. Returns false if the placeholder was deleted. */
	replace(text: string): Promise<boolean> {
		return this.swap(this.token, text);
	}

	/** Takes the placeholder out again, with the blank lines it added. */
	async remove(): Promise<void> {
		if (await this.swap(this.inserted, '')) return;
		await this.swap(this.token, '');
	}
}
