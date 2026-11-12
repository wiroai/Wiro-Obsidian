import { ButtonComponent, Component, MarkdownRenderer, Modal, type App } from 'obsidian';
import { errorMessage, TaskCancelledError } from '../wiro/errors';
import type { ChatResult } from '../wiro/gateway';
import { formatCost } from '../wiro/task';

export interface TextAction {
	label: string;
	cta?: boolean;
	run: (text: string) => void;
}

export interface TextResultOptions {
	title: string;
	/** "Gemini 3 Flash · input $0.50, output $3.00 per million tokens". */
	subtitle: string;
	sourcePath: string;
	run: (onText: (text: string) => void, signal: AbortSignal) => Promise<ChatResult>;
	actions: TextAction[];
	onDone?: (result: ChatResult) => void;
}

/** Shows an LLM answer as it is written, then offers to put it in the note. */
export class TextResultModal extends Modal {
	private readonly controller = new AbortController();
	private readonly renderer = new Component();
	private text = '';
	private finished = false;

	constructor(
		app: App,
		private readonly options: TextResultOptions,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle(this.options.title);
		contentEl.addClass('wiro-text-result');
		contentEl.createDiv({ cls: 'wiro-prompt-note', text: this.options.subtitle });
		const output = contentEl.createDiv({ cls: 'wiro-text-output' });
		const live = output.createDiv({ cls: 'wiro-text-live' });
		const status = contentEl.createDiv({ cls: 'wiro-dialog-price', text: 'Writing…' });
		const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
		const actionButtons = this.options.actions.map((action) => {
			const button = new ButtonComponent(buttons).setButtonText(action.label).setDisabled(true);
			if (action.cta) button.setCta();
			button.onClick(() => {
				if (!this.finished) return;
				this.close();
				action.run(this.text.trim());
			});
			return button;
		});
		const stop = new ButtonComponent(buttons).setButtonText('Stop').onClick(() => {
			if (this.finished) this.close();
			else this.controller.abort();
		});

		this.renderer.load();
		void this.options
			.run((piece) => {
				this.text += piece;
				live.setText(this.text);
				output.scrollTop = output.scrollHeight;
			}, this.controller.signal)
			.then(
				async (result) => {
					this.text = result.text || this.text;
					this.finished = true;
					output.empty();
					await MarkdownRenderer.render(this.app, this.text, output.createDiv(), this.options.sourcePath, this.renderer);
					const cost = result.costUsd !== undefined ? formatCost(String(result.costUsd)) : '';
					status.setText(`${result.finishReason === 'length' ? 'The answer reached the length limit. ' : ''}${cost ? `Cost: ${cost}.` : 'Done.'}`);
					for (const button of actionButtons) button.setDisabled(!this.text.trim());
					stop.setButtonText('Close');
					this.options.onDone?.(result);
				},
				(error: unknown) => {
					this.finished = true;
					const cancelled = error instanceof TaskCancelledError || this.controller.signal.aborted;
					status.setText(cancelled ? 'Stopped.' : `Wiro AI: ${errorMessage(error)}`);
					status.addClass(cancelled ? 'wiro-muted' : 'wiro-error');
					for (const button of actionButtons) button.setDisabled(!this.text.trim());
					stop.setButtonText('Close');
				},
			);
	}

	onClose(): void {
		if (!this.finished) this.controller.abort();
		this.renderer.unload();
		this.contentEl.empty();
	}
}
