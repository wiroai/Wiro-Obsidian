import { debounce, FuzzySuggestModal, Notice, SuggestModal, type App, type TFile } from 'obsidian';
import { EXTENSIONS, kindOfExtension, type MediaKind } from '../vault/files';
import type { CatalogEntry, WiroClient } from '../wiro/client';
import { errorMessage } from '../wiro/errors';
import { shortPrice } from '../wiro/pricing';
import { parseModelSlug } from '../wiro/schema';
import { parseWorkflowSlug, type WorkflowSummary } from '../wiro/workflow';

/** An embed in the open note, resolved to its vault file. */
export interface EmbedChoice {
	file: TFile;
	line: number;
}

/** Picks one of the image or audio embeds of the note. */
export class EmbedPicker extends SuggestModal<EmbedChoice> {
	constructor(
		app: App,
		private readonly choices: EmbedChoice[],
		private readonly onPick: (choice: EmbedChoice) => void,
	) {
		super(app);
		this.setPlaceholder('Pick a file from this note');
	}

	getSuggestions(query: string): EmbedChoice[] {
		const lower = query.toLowerCase();
		return this.choices.filter((choice) => choice.file.path.toLowerCase().includes(lower));
	}

	renderSuggestion(choice: EmbedChoice, el: HTMLElement): void {
		el.createDiv({ text: choice.file.name });
		el.createEl('small', { cls: 'wiro-suggestion-detail', text: `Line ${choice.line + 1} · ${choice.file.path}` });
	}

	onChooseSuggestion(choice: EmbedChoice): void {
		this.onPick(choice);
	}
}

/** Picks any vault file of a kind, for a form's file input. */
export class VaultFilePicker extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly kind: MediaKind | 'file',
		private readonly onPick: (file: TFile) => void,
	) {
		super(app);
		this.setPlaceholder({ file: 'Pick a file', image: 'Pick an image', audio: 'Pick an audio file', video: 'Pick a video' }[kind]);
	}

	getItems(): TFile[] {
		return this.app.vault.getFiles().filter((file) => {
			if (this.kind === 'file' || kindOfExtension(file.extension) === this.kind) return true;
			// Voice recordings are .webm files, which count as video by extension alone.
			return this.kind === 'audio' && EXTENSIONS.audio.has(file.extension.toLowerCase());
		});
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onPick(file);
	}
}

/** Lists models of the public catalog by category, with search, and picks one. */
export class CatalogPicker extends SuggestModal<CatalogEntry> {
	private models: CatalogEntry[] = [];
	private loading = true;
	private error = '';
	private lastQuery = '';
	private readonly searchCatalog = debounce((query: string) => void this.load(query), 400, true);

	constructor(
		app: App,
		private readonly client: WiroClient,
		private readonly categories: string[],
		private readonly onPick: (model: CatalogEntry) => void,
	) {
		super(app);
		this.setPlaceholder('Search models, or paste a model ID or wiro.ai/models link');
		this.emptyStateText = 'Loading the catalog…';
		void this.load('');
	}

	private async load(query: string): Promise<void> {
		this.loading = true;
		try {
			const result = await this.client.toolList({ categories: this.categories, search: query || undefined, limit: 60 });
			this.models = result.models;
			this.error = '';
		} catch (error) {
			this.error = errorMessage(error);
			this.models = [];
		}
		this.loading = false;
		this.emptyStateText = this.error ? `Could not load the catalog: ${this.error}` : 'No models found.';
		// Redraw the list for the current text.
		this.inputEl.dispatchEvent(new Event('input'));
	}

	getSuggestions(query: string): CatalogEntry[] {
		const trimmed = query.trim();
		if (trimmed !== this.lastQuery) {
			this.lastQuery = trimmed;
			this.searchCatalog(trimmed);
		}
		const typed = parseModelSlug(trimmed);
		const results = [...this.models];
		if (typed && !results.some((model) => model.slug === typed)) {
			results.unshift({ slug: typed, title: `Use ${typed}`, categories: [], pricing: { rows: [] } });
		}
		return this.loading && results.length === 0 ? [] : results;
	}

	renderSuggestion(model: CatalogEntry, el: HTMLElement): void {
		el.addClass('wiro-catalog-row');
		const top = el.createDiv({ cls: 'wiro-catalog-top' });
		top.createSpan({ cls: 'wiro-catalog-slug', text: model.slug });
		if (model.pricing.rows.length > 0 || model.pricing.estimatedUsd) {
			top.createSpan({ cls: 'wiro-catalog-price', text: shortPrice(model.pricing) });
		}
		if (model.title && !model.title.startsWith('Use ')) el.createEl('small', { cls: 'wiro-suggestion-detail', text: model.title });
	}

	onChooseSuggestion(model: CatalogEntry): void {
		this.onPick(model);
	}
}

export interface CategoryChoice {
	label: string;
	categories: string[];
}

/** The catalog sections for "Run a model". */
export const MODEL_CATEGORIES: CategoryChoice[] = [
	{ label: 'Text to image', categories: ['text-to-image'] },
	{ label: 'Image editing', categories: ['image-editing'] },
	{ label: 'Image to image', categories: ['image-to-image'] },
	{ label: 'Upscaling and restoration', categories: ['upscale'] },
	{ label: 'Text to video', categories: ['text-to-video'] },
	{ label: 'Image to video', categories: ['image-to-video'] },
	{ label: 'Video to video', categories: ['video-to-video'] },
	{ label: 'Talking head', categories: ['talking-head'] },
	{ label: 'Text to speech', categories: ['text-to-speech'] },
	{ label: 'Speech to text', categories: ['speech-to-text'] },
	{ label: 'Text to music', categories: ['text-to-music'] },
	{ label: 'Text to song', categories: ['text-to-song'] },
	{ label: 'Voice cloning', categories: ['voice-clone'] },
	{ label: '3D generation', categories: ['3d-generation'] },
	{ label: 'LLM chat', categories: ['llm'] },
	{ label: 'All models', categories: [] },
];

export class CategoryPicker extends SuggestModal<CategoryChoice> {
	constructor(
		app: App,
		private readonly onPick: (choice: CategoryChoice) => void,
	) {
		super(app);
		this.setPlaceholder('Pick a kind of model');
	}

	getSuggestions(query: string): CategoryChoice[] {
		const lower = query.toLowerCase();
		return MODEL_CATEGORIES.filter((choice) => choice.label.toLowerCase().includes(lower));
	}

	renderSuggestion(choice: CategoryChoice, el: HTMLElement): void {
		el.setText(choice.label);
	}

	onChooseSuggestion(choice: CategoryChoice): void {
		this.onPick(choice);
	}
}

/** Lists the project's workflows, and takes a pasted workflow link or slug. */
export class WorkflowPicker extends SuggestModal<WorkflowSummary> {
	private workflows: WorkflowSummary[] = [];

	constructor(
		app: App,
		client: WiroClient,
		private readonly onPick: (workflow: WorkflowSummary) => void,
	) {
		super(app);
		this.setPlaceholder('Pick a workflow, or paste a wiro.ai/workflows link');
		this.emptyStateText = 'Loading your workflows…';
		client.workflowList().then(
			(workflows) => {
				this.workflows = workflows;
				this.emptyStateText = 'No workflows in this project yet. Paste a workflow link to run it.';
				this.inputEl.dispatchEvent(new Event('input'));
			},
			(error: unknown) => {
				this.emptyStateText = `Could not load your workflows: ${errorMessage(error)}`;
				this.inputEl.dispatchEvent(new Event('input'));
				new Notice(`Wiro AI: ${errorMessage(error)}`);
			},
		);
	}

	getSuggestions(query: string): WorkflowSummary[] {
		const trimmed = query.trim();
		const typed = parseWorkflowSlug(trimmed);
		const lower = trimmed.toLowerCase();
		const matches = this.workflows.filter(
			(workflow) => workflow.title.toLowerCase().includes(lower) || workflow.fullSlug.toLowerCase().includes(lower),
		);
		if (typed && !matches.some((workflow) => workflow.fullSlug === typed)) {
			matches.unshift({ fullSlug: typed, title: `Run ${typed}` });
		}
		return matches;
	}

	renderSuggestion(workflow: WorkflowSummary, el: HTMLElement): void {
		el.createDiv({ text: workflow.title });
		const detail = [workflow.fullSlug, workflow.stepCount !== undefined ? `${workflow.stepCount} steps` : ''].filter(Boolean).join(' · ');
		el.createEl('small', { cls: 'wiro-suggestion-detail', text: detail });
	}

	onChooseSuggestion(workflow: WorkflowSummary): void {
		this.onPick(workflow);
	}
}
