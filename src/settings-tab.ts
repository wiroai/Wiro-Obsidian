import {
	debounce,
	Notice,
	PluginSettingTab,
	type App,
	type ButtonComponent,
	type SettingDefinitionItem,
	type SettingDefinitionPage,
	type SettingGroupItem,
} from 'obsidian';
import { catalogModels, FEATURE_IDS, FEATURES, modelName, type FeatureId } from './catalog';
import type WiroPlugin from './main';
import { CatalogPicker } from './ui/pickers';
import { WiroClient } from './wiro/client';
import { errorMessage } from './wiro/errors';
import type { GatewayModel } from './wiro/gateway';
import { formatUsd, shortPrice } from './wiro/pricing';
import { defaultOption, optionParams, parseExtraParams, parseModelSlug, sentenceCaseLabel } from './wiro/schema';
import { explainRunError } from './wiro/task';

/** Control keys for features look like "feature:image:model" and "option:image:aspectRatio". */
const FEATURE_PREFIX = 'feature:';
const OPTION_PREFIX = 'option:';

const STRING_KEYS = ['apiKeySecretId', 'apiSecretSecretId', 'imageFolder', 'videoFolder', 'audioFolder', 'textModel', 'translateLanguage'] as const;
const BOOLEAN_KEYS = ['speechPlainText', 'confirmRuns', 'editorMenu'] as const;
type StringKey = (typeof STRING_KEYS)[number];
type BooleanKey = (typeof BOOLEAN_KEYS)[number];

function isStringKey(key: string): key is StringKey {
	return (STRING_KEYS as readonly string[]).includes(key);
}

function isBooleanKey(key: string): key is BooleanKey {
	return (BOOLEAN_KEYS as readonly string[]).includes(key);
}

function isFeature(value: string): value is FeatureId {
	return (FEATURE_IDS as string[]).includes(value);
}

/** "feature:image:model" or "option:image:aspectRatio" split into its parts. */
function parseKey(key: string, prefix: string): { feature: FeatureId; name: string } | null {
	if (!key.startsWith(prefix)) return null;
	const rest = key.slice(prefix.length);
	const colon = rest.indexOf(':');
	const feature = rest.slice(0, colon);
	const name = rest.slice(colon + 1);
	if (colon < 0 || !isFeature(feature) || !name) return null;
	return { feature, name };
}

function link(text: string, href: string): DocumentFragment {
	return createFragment((fragment) => {
		fragment.createEl('a', { text, href });
	});
}

export class WiroSettingTab extends PluginSettingTab {
	/** Redraws the options after a model change settles. */
	private readonly refreshSoon = debounce(() => this.update(), 300, true);
	private gatewayModels: GatewayModel[] | null = null;
	private gatewayError = '';

	constructor(
		app: App,
		private readonly plugin: WiroPlugin,
	) {
		super(app, plugin);
		this.icon = 'sparkles';
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'API key',
				desc: createFragment((fragment) => {
					fragment.appendText('The API key of your Wiro AI project. Obsidian keeps it in its keychain, outside the vault. Create a project at ');
					fragment.createEl('a', { text: 'wiro.ai/panel/project/new', href: 'https://wiro.ai/panel/project/new' });
					fragment.appendText('.');
				}),
				aliases: ['key', 'token', 'credentials'],
				control: { type: 'secret', key: 'apiKeySecretId' },
			},
			{
				name: 'API secret',
				desc: 'Only for projects that use signature-based authentication. Leave it empty for API key only projects.',
				control: { type: 'secret', key: 'apiSecretSecretId' },
			},
			{
				name: 'Check the key',
				desc: 'Sends one free request to Wiro AI to see if it accepts the key.',
				render: (setting) => {
					setting.addButton((button) =>
						button.setButtonText('Check').onClick(() => {
							void this.checkKey(button);
						}),
					);
				},
			},
			{
				type: 'group',
				heading: 'Models',
				items: [...FEATURE_IDS.map((feature) => this.featurePage(feature)), this.textPage()],
			},
			{
				type: 'group',
				heading: 'Files',
				items: [
					{
						name: 'Image folder',
						desc: 'Where new images are saved. Leave it empty to use the attachment folder from Files and links.',
						control: { type: 'folder', key: 'imageFolder' },
					},
					{
						name: 'Video folder',
						desc: 'Where new videos are saved. Leave it empty to use the attachment folder.',
						control: { type: 'folder', key: 'videoFolder' },
					},
					{
						name: 'Audio folder',
						desc: 'Where speech and music files are saved. Leave it empty to use the attachment folder.',
						control: { type: 'folder', key: 'audioFolder' },
					},
				],
			},
			{
				type: 'group',
				heading: 'Runs',
				items: [
					{
						name: 'Show the price before running',
						desc: 'Commands that use the selection, the whole note or an embed open a dialog with the price first. Turn it off to run them right away.',
						control: { type: 'toggle', key: 'confirmRuns' },
					},
					{
						name: 'Editor menu',
						desc: 'Show image, speech and text commands when you right-click selected text.',
						control: { type: 'toggle', key: 'editorMenu' },
					},
				],
			},
		];
	}

	private featurePage(feature: FeatureId): SettingDefinitionPage {
		const info = FEATURES[feature];
		const slug = parseModelSlug(this.plugin.settings.features[feature].model);
		const choices: Record<string, string> = {};
		for (const model of catalogModels(feature)) choices[model.slug] = model.name;
		if (slug && !(slug in choices)) choices[slug] = slug;
		const items: SettingDefinitionItem[] = [
			{
				name: 'Model',
				desc: slug ? link(`Prices and details on wiro.ai/models/${slug}`, `https://wiro.ai/models/${slug}`) : 'Pick a model.',
				control: { type: 'dropdown', key: `${FEATURE_PREFIX}${feature}:model`, options: choices },
			},
			{
				name: 'Browse the catalog',
				desc: `Pick any ${info.categories.map((category) => category.replace(/-/g, ' ')).join(', ')} model from wiro.ai/models, or paste a model ID.`,
				render: (setting) => {
					setting.addButton((button) =>
						button.setButtonText('Browse').onClick(() => {
							new CatalogPicker(this.app, new WiroClient(this.plugin.http, null), info.categories, (model) => {
								void this.setControlValue(`${FEATURE_PREFIX}${feature}:model`, model.slug);
							}).open();
						}),
					);
				},
			},
			...this.optionItems(feature, slug),
			{
				name: 'Extra parameters',
				desc: 'A JSON object sent with every run, for model parameters without a dropdown. Example: {"seed": 42}',
				control: {
					type: 'textarea',
					key: `${FEATURE_PREFIX}${feature}:extraParams`,
					validate: (value) => {
						try {
							parseExtraParams(value);
							return undefined;
						} catch (error) {
							return errorMessage(error);
						}
					},
				},
			},
		];
		if (feature === 'speech') {
			items.push({
				name: 'Read Markdown as plain text',
				desc: 'Skips formatting marks, URLs, embeds and code, and reads the text of links.',
				control: { type: 'toggle', key: 'speechPlainText' },
			});
		}
		if (feature === 'transcribe') {
			items.push({
				name: 'Transcript style',
				desc: 'How the transcript goes under the audio file.',
				render: (setting) => {
					setting.addDropdown((dropdown) =>
						dropdown
							.addOption('callout', 'Callout')
							.addOption('quote', 'Quote')
							.addOption('paragraph', 'Plain paragraph')
							.setValue(this.plugin.settings.transcriptStyle)
							.onChange((value) => {
								if (value === 'callout' || value === 'quote' || value === 'paragraph') {
									this.plugin.settings.transcriptStyle = value;
									void this.plugin.saveSettings();
								}
							}),
					);
				},
			});
		}
		return {
			type: 'page',
			name: info.name,
			desc: info.commands,
			displayValue: () => {
				const current = parseModelSlug(this.plugin.settings.features[feature].model);
				return current ? modelName(current) : 'No model';
			},
			items,
		};
	}

	/** The price and one dropdown per select parameter of the feature's model. */
	private optionItems(feature: FeatureId, slug: string | null): SettingGroupItem[] {
		if (!slug) return [];
		const schemas = this.plugin.schemas;
		const schema = schemas.peek(slug);
		if (!schema) {
			const error = schemas.error(slug);
			return [
				{
					name: 'Model options',
					desc: error ? `Could not load the options of ${slug}: ${error}` : `Loading the options of ${slug}…`,
					// Runs when the row is drawn, so only an open settings tab loads anything.
					render: (setting) => {
						if (error) {
							setting.addButton((button) =>
								button.setButtonText('Try again').onClick(() => {
									void schemas.load(slug).then(
										() => this.update(),
										() => this.update(),
									);
								}),
							);
							return;
						}
						if (schemas.isLoading(slug)) return;
						void schemas.load(slug).then(
							() => this.update(),
							() => this.update(),
						);
					},
				},
			];
		}
		const rows: SettingGroupItem[] = [];
		if (schema.pricing && (schema.pricing.rows.length > 0 || schema.pricing.estimatedUsd)) {
			rows.push({ name: 'Price', desc: `${shortPrice(schema.pricing)}. The run dialog shows the price for your settings.` });
		}
		for (const param of optionParams(schema)) {
			const choices: Record<string, string> = {};
			for (const option of param.options ?? []) choices[option.value] = option.label.trim() || 'Model default';
			rows.push({
				name: sentenceCaseLabel(param.label),
				control: {
					type: 'dropdown' as const,
					key: `${OPTION_PREFIX}${feature}:${param.id}`,
					options: choices,
					defaultValue: defaultOption(param),
				},
			});
		}
		return rows;
	}

	private textPage(): SettingDefinitionPage {
		const current = this.plugin.settings.textModel;
		const items: SettingDefinitionItem[] = [];
		if (this.gatewayModels) {
			const choices: Record<string, string> = {};
			for (const model of this.gatewayModels) {
				const price =
					model.inputPerMillion !== undefined && model.outputPerMillion !== undefined && (model.inputPerMillion > 0 || model.outputPerMillion > 0)
						? ` (${formatUsd(model.inputPerMillion)} / ${formatUsd(model.outputPerMillion)} per 1M tokens)`
						: '';
				choices[model.id] = `${model.name}${price}`;
			}
			if (!(current in choices)) choices[current] = current;
			items.push({
				name: 'Model',
				desc: 'The LLM gateway model for Summarize, Rewrite, Translate, Continue writing and Ask about this note. Prices are for input and output tokens.',
				control: { type: 'dropdown', key: 'textModel', options: choices },
			});
		} else {
			items.push({
				name: 'Model',
				desc: this.gatewayError ? `Could not load the models: ${this.gatewayError}` : `Loading the LLM gateway models… Current: ${current}`,
				render: () => {
					if (this.gatewayError) return;
					void this.plugin.gatewayModels().then(
						(models) => {
							this.gatewayModels = models;
							this.update();
						},
						(error: unknown) => {
							this.gatewayError = errorMessage(error);
							this.update();
						},
					);
				},
			});
		}
		items.push({
			name: 'Translate into',
			desc: 'The language listed first when you translate.',
			control: { type: 'text', key: 'translateLanguage' },
		});
		return {
			type: 'page',
			name: 'Text',
			desc: 'Summarize, Rewrite, Translate, Continue writing, Ask about this note',
			displayValue: () => this.gatewayModels?.find((model) => model.id === this.plugin.settings.textModel)?.name ?? this.plugin.settings.textModel,
			items,
		};
	}

	private async checkKey(button: ButtonComponent): Promise<void> {
		const credentials = this.plugin.credentials();
		if (!credentials) {
			new Notice('Add an API key first.');
			return;
		}
		button.setDisabled(true);
		try {
			await this.plugin.client(credentials).checkKey();
			new Notice('Wiro AI accepted the key.');
		} catch (error) {
			new Notice(`Wiro AI: ${errorMessage(explainRunError(error, ''))}`);
		} finally {
			button.setDisabled(false);
		}
	}

	getControlValue(key: string): unknown {
		const settings = this.plugin.settings;
		const option = parseKey(key, OPTION_PREFIX);
		if (option) {
			const slug = parseModelSlug(settings.features[option.feature].model);
			return slug ? settings.modelOptions[slug]?.[option.name] : undefined;
		}
		const feature = parseKey(key, FEATURE_PREFIX);
		if (feature) {
			const entry = settings.features[feature.feature];
			return feature.name === 'model' ? entry.model : feature.name === 'extraParams' ? entry.extraParams : undefined;
		}
		if (isBooleanKey(key)) return settings[key];
		if (isStringKey(key)) return settings[key];
		return undefined;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings;
		let redraw = false;
		const option = parseKey(key, OPTION_PREFIX);
		const feature = parseKey(key, FEATURE_PREFIX);
		if (option) {
			const slug = parseModelSlug(settings.features[option.feature].model);
			if (!slug || typeof value !== 'string') return;
			settings.modelOptions[slug] = { ...settings.modelOptions[slug], [option.name]: value };
		} else if (feature) {
			if (typeof value !== 'string') return;
			if (feature.name === 'model') {
				settings.features[feature.feature].model = value;
				redraw = true;
			} else if (feature.name === 'extraParams') {
				settings.features[feature.feature].extraParams = value;
			}
		} else if (isBooleanKey(key)) {
			if (typeof value === 'boolean') settings[key] = value;
		} else if (isStringKey(key)) {
			settings[key] = typeof value === 'string' ? value : '';
		} else {
			return;
		}
		await this.plugin.saveSettings();
		if (redraw) this.refreshSoon();
	}
}
