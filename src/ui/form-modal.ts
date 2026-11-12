import { ButtonComponent, DropdownComponent, Modal, TextAreaComponent, TextComponent, ToggleComponent, type App, type TFile } from 'obsidian';
import type { MediaKind } from '../vault/files';
import { VaultFilePicker } from './pickers';

export type FieldKind = 'text' | 'textarea' | 'select' | 'number' | 'toggle' | 'file';

export interface FormField {
	key: string;
	label: string;
	kind: FieldKind;
	required: boolean;
	advanced?: boolean;
	fileKind?: MediaKind | 'file';
	/** File fields that take more than one file. */
	multiple?: boolean;
	options?: { value: string; label: string }[];
	defaultValue?: string;
	description?: string;
	min?: number;
	max?: number;
	step?: number;
}

export interface FormValues {
	/** Text, select, number and toggle values, by key. */
	values: Record<string, string | number | boolean>;
	/** Chosen vault files, by key. */
	files: Record<string, TFile[]>;
	/** Pasted file URLs, by key. */
	urls: Record<string, string[]>;
}

export interface FormModalOptions {
	title: string;
	description?: string;
	fields: FormField[];
	/** Starting values, such as the selection for the prompt. */
	initial?: Record<string, string>;
	submitText: string;
	/** The price line for the current values. */
	price?: (form: FormValues) => string;
	onSubmit: (form: FormValues) => void;
}

/** A form built from a model's parameters or a workflow's inputs. */
export class FormModal extends Modal {
	private readonly form: FormValues = { values: {}, files: {}, urls: {} };
	private priceEl: HTMLElement | null = null;
	private button: ButtonComponent | null = null;
	private errorEl: HTMLElement | null = null;

	constructor(
		app: App,
		private readonly options: FormModalOptions,
	) {
		super(app);
		for (const field of options.fields) {
			const start = options.initial?.[field.key] ?? field.defaultValue;
			if (start === undefined || start === '') continue;
			if (field.kind === 'number') {
				const number = Number(start);
				if (Number.isFinite(number)) this.form.values[field.key] = number;
			} else if (field.kind === 'toggle') {
				this.form.values[field.key] = start === 'true';
			} else if (field.kind !== 'file') {
				this.form.values[field.key] = start;
			}
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle(this.options.title);
		contentEl.addClass('wiro-form');
		if (this.options.description) contentEl.createDiv({ cls: 'wiro-form-description', text: this.options.description });

		const main = this.options.fields.filter((field) => !field.advanced);
		const advanced = this.options.fields.filter((field) => field.advanced);
		for (const field of main) this.renderField(contentEl, field);
		if (advanced.length > 0) {
			const details = contentEl.createEl('details', { cls: 'wiro-form-advanced' });
			details.createEl('summary', { text: `More settings (${advanced.length})` });
			for (const field of advanced) this.renderField(details, field);
		}

		const footer = contentEl.createDiv({ cls: 'wiro-dialog-footer' });
		const info = footer.createDiv({ cls: 'wiro-dialog-info' });
		this.priceEl = info.createDiv({ cls: 'wiro-dialog-price' });
		this.errorEl = info.createDiv({ cls: 'wiro-form-error' });
		const buttons = footer.createDiv({ cls: 'modal-button-container' });
		this.button = new ButtonComponent(buttons).setButtonText(this.options.submitText).setCta().onClick(() => this.submit());
		this.scope.register(['Mod'], 'Enter', (event) => {
			event.preventDefault();
			this.submit();
			return false;
		});
		this.updatePrice();
	}

	private renderField(parent: HTMLElement, field: FormField): void {
		const row = parent.createDiv({ cls: 'wiro-form-field' });
		const label = row.createDiv({ cls: 'wiro-form-label', text: field.label });
		if (field.required) label.createSpan({ cls: 'wiro-form-required', text: ' *' });
		if (field.description) row.createDiv({ cls: 'wiro-form-help', text: field.description });
		const current = this.form.values[field.key];

		switch (field.kind) {
			case 'textarea': {
				const input = new TextAreaComponent(row).setValue(typeof current === 'string' ? current : '');
				input.inputEl.addClass('wiro-form-textarea');
				input.onChange((value) => this.setValue(field.key, value));
				break;
			}
			case 'select': {
				const dropdown = new DropdownComponent(row);
				if (!field.required) dropdown.addOption('', 'Model default');
				for (const option of field.options ?? []) dropdown.addOption(option.value, option.label.trim() || option.value);
				dropdown.setValue(typeof current === 'string' ? current : field.required ? (field.options?.[0]?.value ?? '') : '');
				if (field.required && typeof current !== 'string') this.setValue(field.key, dropdown.getValue());
				dropdown.onChange((value) => this.setValue(field.key, value));
				break;
			}
			case 'number': {
				const input = new TextComponent(row).setValue(current === undefined ? '' : String(current));
				input.inputEl.type = 'number';
				if (field.min !== undefined) input.inputEl.min = String(field.min);
				if (field.max !== undefined) input.inputEl.max = String(field.max);
				if (field.step !== undefined) input.inputEl.step = String(field.step);
				input.onChange((value) => {
					const number = Number(value);
					this.setValue(field.key, value.trim() === '' || !Number.isFinite(number) ? '' : number);
				});
				break;
			}
			case 'toggle': {
				const toggle = new ToggleComponent(row).setValue(current === true);
				toggle.onChange((value) => this.setValue(field.key, value));
				break;
			}
			case 'file': {
				const chosen = row.createDiv({ cls: 'wiro-form-files' });
				const showChosen = () => {
					chosen.empty();
					const files = this.form.files[field.key] ?? [];
					if (files.length === 0) chosen.createSpan({ cls: 'wiro-form-help', text: 'No file chosen' });
					for (const file of files) chosen.createSpan({ cls: 'wiro-form-file', text: file.name });
				};
				showChosen();
				const controls = row.createDiv({ cls: 'wiro-form-file-controls' });
				new ButtonComponent(controls).setButtonText(field.multiple ? 'Add a file' : 'Choose a file').onClick(() => {
					new VaultFilePicker(this.app, field.fileKind ?? 'file', (file) => {
						const files = field.multiple ? [...(this.form.files[field.key] ?? []), file] : [file];
						this.form.files[field.key] = files;
						showChosen();
						this.updatePrice();
					}).open();
				});
				const url = new TextComponent(controls).setPlaceholder('or paste a URL');
				url.inputEl.addClass('wiro-form-url');
				url.onChange((value) => {
					const urls = value
						.split(/[\s,]+/)
						.map((entry) => entry.trim())
						.filter((entry) => /^https:\/\//i.test(entry));
					this.form.urls[field.key] = urls;
					this.updatePrice();
				});
				break;
			}
			default: {
				const input = new TextComponent(row).setValue(typeof current === 'string' ? current : '');
				input.onChange((value) => this.setValue(field.key, value));
			}
		}
	}

	private setValue(key: string, value: string | number | boolean): void {
		if (value === '') delete this.form.values[key];
		else this.form.values[key] = value;
		this.updatePrice();
	}

	private updatePrice(): void {
		if (this.errorEl) this.errorEl.setText('');
		if (!this.priceEl || !this.options.price) return;
		this.priceEl.setText(this.options.price(this.form));
	}

	private missing(): string[] {
		return this.options.fields
			.filter((field) => field.required)
			.filter((field) => {
				if (field.kind === 'file') return (this.form.files[field.key]?.length ?? 0) === 0 && (this.form.urls[field.key]?.length ?? 0) === 0;
				const value = this.form.values[field.key];
				return value === undefined || (typeof value === 'string' && value.trim() === '');
			})
			.map((field) => field.label);
	}

	private submit(): void {
		const missing = this.missing();
		if (missing.length > 0) {
			this.errorEl?.setText(`Fill in: ${missing.join(', ')}.`);
			return;
		}
		this.close();
		this.options.onSubmit(this.form);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
