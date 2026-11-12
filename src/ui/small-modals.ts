import { ButtonComponent, Modal, SuggestModal, TextAreaComponent, type App } from 'obsidian';

/** Asks one question, such as what to ask about the note. */
export class QuestionModal extends Modal {
	constructor(
		app: App,
		private readonly options: { title: string; placeholder: string; submitText: string; note?: string; onSubmit: (text: string) => void },
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle(this.options.title);
		const input = new TextAreaComponent(contentEl);
		input.inputEl.addClass('wiro-question-input');
		input.setPlaceholder(this.options.placeholder);
		if (this.options.note) contentEl.createDiv({ cls: 'wiro-prompt-note', text: this.options.note });
		const submit = () => {
			const text = input.getValue().trim();
			if (!text) return;
			this.close();
			this.options.onSubmit(text);
		};
		this.scope.register([], 'Enter', (event) => {
			if (event.shiftKey) return true;
			event.preventDefault();
			submit();
			return false;
		});
		const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
		new ButtonComponent(buttons).setButtonText(this.options.submitText).setCta().onClick(submit);
		input.inputEl.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

const LANGUAGES = [
	'English',
	'Spanish',
	'French',
	'German',
	'Italian',
	'Portuguese',
	'Turkish',
	'Dutch',
	'Polish',
	'Russian',
	'Ukrainian',
	'Arabic',
	'Hebrew',
	'Hindi',
	'Japanese',
	'Korean',
	'Chinese (Simplified)',
	'Chinese (Traditional)',
	'Indonesian',
	'Vietnamese',
	'Thai',
	'Swedish',
	'Greek',
];

/** Picks the language to translate into. Any typed name works too. */
export class LanguagePicker extends SuggestModal<string> {
	constructor(
		app: App,
		private readonly preferred: string,
		private readonly onPick: (language: string) => void,
	) {
		super(app);
		this.setPlaceholder('Translate into…');
	}

	getSuggestions(query: string): string[] {
		const typed = query.trim();
		const list = [this.preferred, ...LANGUAGES.filter((language) => language !== this.preferred)];
		const matches = list.filter((language) => language.toLowerCase().includes(typed.toLowerCase()));
		// A typed name that is not in the list comes last, after the languages it matches.
		if (typed && !matches.some((language) => language.toLowerCase() === typed.toLowerCase())) matches.push(typed);
		return matches;
	}

	renderSuggestion(language: string, el: HTMLElement): void {
		el.setText(language);
	}

	onChooseSuggestion(language: string): void {
		this.onPick(language);
	}
}
