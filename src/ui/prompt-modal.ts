import { ButtonComponent, Modal, TextAreaComponent, type App } from 'obsidian';

export interface PromptModalOptions {
	title: string;
	placeholder: string;
	initialText: string;
	submitText: string;
	/** A line under the text box, such as the model the run will use. */
	note: string;
	onSubmit: (text: string) => void;
}

/** Asks for a prompt, or for the text to speak. Mod+Enter submits. */
export class PromptModal extends Modal {
	constructor(
		app: App,
		private readonly options: PromptModalOptions,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle(this.options.title);
		contentEl.addClass('wiro-prompt');

		const input = new TextAreaComponent(contentEl);
		input.inputEl.addClass('wiro-prompt-input');
		input.setPlaceholder(this.options.placeholder);
		input.setValue(this.options.initialText);

		const submit = () => {
			const text = input.getValue().trim();
			if (!text) {
				input.inputEl.focus();
				return;
			}
			this.close();
			this.options.onSubmit(text);
		};

		this.scope.register(['Mod'], 'Enter', (event) => {
			event.preventDefault();
			submit();
			return false;
		});

		contentEl.createDiv({ cls: 'wiro-prompt-note', text: this.options.note });

		const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
		new ButtonComponent(buttons).setButtonText(this.options.submitText).setCta().onClick(submit);

		input.inputEl.focus();
		input.inputEl.select();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
