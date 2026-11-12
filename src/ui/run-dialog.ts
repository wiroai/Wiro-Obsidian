import { ButtonComponent, DropdownComponent, Modal, TextAreaComponent, type App, type TFile } from 'obsidian';
import { FEATURES, type FeatureId } from '../catalog';
import type { SchemaCache } from '../schema-cache';
import type { WiroSettings } from '../settings';
import { markdownToSpeechText } from '../text/speech-text';
import { priceLine, quote, type PriceQuote } from '../wiro/pricing';
import { composeRunParams, defaultOption, sentenceCaseLabel, type ModelSchema, type ParamDef } from '../wiro/schema';
import { slotsFor, type SlotName } from '../wiro/slots';

/** The slots shown as quick options in the dialog, per feature. */
const QUICK_SLOTS: Record<FeatureId, SlotName[]> = {
	image: ['ratio', 'resolution'],
	edit: ['ratio', 'resolution'],
	upscale: [],
	video: ['duration', 'ratio', 'resolution'],
	speech: ['voice', 'language'],
	music: ['duration'],
	transcribe: ['language'],
};

export interface RunDialogOptions {
	feature: FeatureId;
	title: string;
	/** Shown when the feature takes text. */
	initialText: string;
	placeholder: string;
	submitText: string;
	modelName: string;
	slug: string;
	/** A source file to preview, such as the image to edit. */
	preview?: TFile;
	/** Seconds of the input audio, for per-second prices. */
	mediaSeconds?: number;
	/** Put the focus on the button instead of the text, so Enter runs right away. */
	focusButton?: boolean;
	onSubmit: (text: string, quote: PriceQuote | null) => void;
}

/** Asks for the prompt or text of a run, shows the model's main options and the price before it runs. */
export class RunDialog extends Modal {
	private schema: ModelSchema | null;
	private text: string;
	private readonly values: Record<string, string>;
	private priceEl: HTMLElement | null = null;
	private button: ButtonComponent | null = null;
	private current: PriceQuote | null = null;

	constructor(
		app: App,
		private readonly settings: WiroSettings,
		private readonly schemas: SchemaCache,
		private readonly options: RunDialogOptions,
		private readonly saveOption: (slug: string, param: string, value: string) => void,
	) {
		super(app);
		this.schema = schemas.peek(options.slug);
		this.text = options.initialText;
		this.values = { ...(settings.modelOptions[options.slug] ?? {}) };
	}

	onOpen(): void {
		this.setTitle(this.options.title);
		this.render();
		if (!this.schemas.isLoading(this.options.slug)) {
			void this.schemas.load(this.options.slug).then(
				(schema) => {
					this.schema = schema;
					this.renderOptions();
					this.updatePrice();
				},
				() => undefined,
			);
		}
	}

	private optionsEl: HTMLElement | null = null;

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('wiro-dialog');
		const feature = FEATURES[this.options.feature];

		if (this.options.preview) {
			const src = this.app.vault.getResourcePath(this.options.preview);
			const figure = contentEl.createDiv({ cls: 'wiro-dialog-preview' });
			if (feature.input === 'audio') figure.createEl('audio', { attr: { src, controls: 'true' } });
			else figure.createEl('img', { attr: { src, alt: this.options.preview.name } });
			figure.createDiv({ cls: 'wiro-dialog-caption', text: this.options.preview.path });
		}

		let input: TextAreaComponent | null = null;
		if (feature.takesText) {
			input = new TextAreaComponent(contentEl);
			input.inputEl.addClass('wiro-prompt-input');
			input.setPlaceholder(this.options.placeholder);
			input.setValue(this.text);
			input.onChange((value) => {
				this.text = value;
				this.updatePrice();
			});
		}

		this.optionsEl = contentEl.createDiv({ cls: 'wiro-dialog-options' });
		this.renderOptions();

		const footer = contentEl.createDiv({ cls: 'wiro-dialog-footer' });
		const info = footer.createDiv({ cls: 'wiro-dialog-info' });
		info.createDiv({ cls: 'wiro-prompt-note', text: `Model: ${this.options.modelName}. Change it in the Wiro AI settings.` });
		this.priceEl = info.createDiv({ cls: 'wiro-dialog-price' });

		const buttons = footer.createDiv({ cls: 'modal-button-container' });
		this.button = new ButtonComponent(buttons).setCta().onClick(() => this.submit(input));
		this.updatePrice();

		this.scope.register(['Mod'], 'Enter', (event) => {
			event.preventDefault();
			this.submit(input);
			return false;
		});

		if (input && !this.options.focusButton) {
			input.inputEl.focus();
			input.inputEl.select();
		} else {
			this.button.buttonEl.focus();
		}
	}

	/** The quick option dropdowns for the model's ratio, resolution, duration, voice or language. */
	private renderOptions(): void {
		const el = this.optionsEl;
		if (!el) return;
		el.empty();
		const schema = this.schema;
		if (!schema) return;
		const named = slotsFor(schema).named;
		const params = QUICK_SLOTS[this.options.feature]
			.map((slot) => named[slot])
			.filter((param): param is ParamDef => param?.type === 'select' && (param.options?.length ?? 0) > 1);
		for (const param of params) {
			const row = el.createDiv({ cls: 'wiro-dialog-option' });
			row.createSpan({ cls: 'wiro-dialog-option-label', text: sentenceCaseLabel(param.label) });
			const dropdown = new DropdownComponent(row);
			for (const option of param.options ?? []) dropdown.addOption(option.value, option.label.trim() || 'Model default');
			const saved = this.values[param.id];
			dropdown.setValue(saved !== undefined && param.options?.some((option) => option.value === saved) ? saved : defaultOption(param));
			dropdown.onChange((value) => {
				this.values[param.id] = value;
				this.saveOption(this.options.slug, param.id, value);
				this.updatePrice();
			});
		}
	}

	private updatePrice(): void {
		const feature = FEATURES[this.options.feature];
		const text = this.options.feature === 'speech' && this.settings.speechPlainText ? markdownToSpeechText(this.text) : this.text.trim();
		const params = composeRunParams(this.schema, {
			text: feature.takesText ? text : null,
			options: this.values,
		});
		this.current = this.schema
			? quote(this.schema.pricing, params, { promptChars: text.length, mediaSeconds: this.options.mediaSeconds })
			: null;
		if (this.priceEl) {
			this.priceEl.setText(this.current ? `Price: ${priceLine(this.current)}` : '');
		}
		if (this.button) {
			const amount = this.current && this.current.label !== 'by run time' ? ` · ${this.current.label}` : '';
			this.button.setButtonText(`${this.options.submitText}${amount}`);
		}
	}

	private submit(input: TextAreaComponent | null): void {
		const text = input ? input.getValue().trim() : '';
		if (input && !text) {
			input.inputEl.focus();
			return;
		}
		this.close();
		this.options.onSubmit(text, this.current);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
