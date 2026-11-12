import {
	debounce,
	Notice,
	PluginSettingTab,
	type App,
	type ButtonComponent,
	type SettingDefinitionGroup,
	type SettingDefinitionItem,
	type SettingGroupItem,
} from 'obsidian';
import { catalogModels, selectedModel } from './catalog';
import type WiroPlugin from './main';
import { CUSTOM_MODEL, kindKeys, type WiroSettings } from './settings';
import type { MediaKind } from './vault/files';
import { errorMessage } from './wiro/errors';
import { defaultOption, optionParams, parseExtraParams, parseModelSlug, sentenceCaseLabel } from './wiro/schema';
import { explainRunError } from './wiro/task';

/** Control keys for a model's options look like "option:image:aspectRatio". */
const OPTION_PREFIX = 'option:';

type StringKey = Exclude<keyof WiroSettings, 'speechPlainText' | 'modelOptions'>;

const STRING_KEYS = new Set<string>([
	'apiKeySecretId',
	'apiSecretSecretId',
	'imageModel',
	'imageCustomModel',
	'imageExtraParams',
	'imageFolder',
	'speechModel',
	'speechCustomModel',
	'speechExtraParams',
	'speechFolder',
] satisfies StringKey[]);

function isStringKey(key: string): key is StringKey {
	return STRING_KEYS.has(key);
}

function parseOptionKey(key: string): { kind: MediaKind; param: string } | null {
	if (!key.startsWith(OPTION_PREFIX)) return null;
	const rest = key.slice(OPTION_PREFIX.length);
	const colon = rest.indexOf(':');
	const kind = rest.slice(0, colon);
	const param = rest.slice(colon + 1);
	if (colon < 0 || (kind !== 'image' && kind !== 'speech') || !param) return null;
	return { kind, param };
}

function link(text: string, href: string): DocumentFragment {
	return createFragment((fragment) => {
		fragment.createEl('a', { text, href });
	});
}

export class WiroSettingTab extends PluginSettingTab {
	/** Redraws the options after the user stops typing a model ID. */
	private readonly refreshOptions = debounce(() => this.update(), 800, true);

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
			this.mediaGroup('image'),
			this.mediaGroup('speech'),
		];
	}

	private mediaGroup(kind: MediaKind): SettingDefinitionGroup {
		const keys = kindKeys(kind);
		const modelChoices: Record<string, string> = {};
		for (const model of catalogModels(kind)) modelChoices[model.slug] = model.name;
		const saved = this.plugin.settings[keys.model];
		if (saved !== CUSTOM_MODEL && !(saved in modelChoices)) modelChoices[saved] = saved;
		modelChoices[CUSTOM_MODEL] = 'Other model';

		const model = selectedModel(this.plugin.settings, kind);
		const items: SettingGroupItem[] = [
			{
				name: 'Model',
				desc: model.slug
					? link(`Prices and details on wiro.ai/models/${model.slug}`, `https://wiro.ai/models/${model.slug}`)
					: 'Any model from wiro.ai/models.',
				control: { type: 'dropdown', key: keys.model, options: modelChoices },
			},
			{
				name: 'Model ID',
				desc: 'The end of the model page URL, such as google/nano-banana-pro for wiro.ai/models/google/nano-banana-pro.',
				visible: () => this.plugin.settings[keys.model] === CUSTOM_MODEL,
				control: {
					type: 'text',
					key: keys.customModel,
					validate: (value) =>
						value.trim() && !parseModelSlug(value) ? 'Use the owner/model form, such as google/nano-banana-pro.' : undefined,
				},
			},
			...this.optionItems(kind),
			{
				name: 'Extra parameters',
				desc: 'A JSON object sent with every run, for model parameters not listed above. Example: {"seed": 42}',
				control: {
					type: 'textarea',
					key: keys.extraParams,
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
			{
				name: 'Folder',
				desc: 'Where new files are saved. Leave it empty to use the attachment folder from Files and links.',
				control: { type: 'folder', key: keys.folder },
			},
		];
		if (kind === 'speech') {
			items.push({
				name: 'Read Markdown as plain text',
				desc: 'Skips formatting marks, URLs, embeds and code, and reads the text of links.',
				control: { type: 'toggle', key: 'speechPlainText' },
			});
		}
		return { type: 'group', heading: kind === 'image' ? 'Images' : 'Speech', items };
	}

	/** One dropdown per select parameter of the chosen model. */
	private optionItems(kind: MediaKind): SettingGroupItem[] {
		const { slug } = selectedModel(this.plugin.settings, kind);
		if (!slug) return [];
		const schemas = this.plugin.schemas;
		const schema = schemas.peek(slug);
		if (!schema) {
			const error = schemas.error(slug);
			if (error) {
				return [
					{
						name: 'Model options',
						desc: `Could not load the options of ${slug}: ${error}`,
						render: (setting) => {
							setting.addButton((button) =>
								button.setButtonText('Try again').onClick(() => {
									void schemas.load(slug).then(
							() => this.update(),
							() => this.update(),
						);
								}),
							);
						},
					},
				];
			}
			return [
				{
					name: 'Model options',
					desc: `Loading the options of ${slug}…`,
					// Runs when the row is drawn, so only an open settings tab loads anything.
					render: () => {
						if (schemas.isLoading(slug)) return;
						void schemas.load(slug).then(
							() => this.update(),
							() => this.update(),
						);
					},
				},
			];
		}
		return optionParams(schema).map((param) => {
			const choices: Record<string, string> = {};
			for (const option of param.options ?? []) {
				choices[option.value] = option.label.trim() || 'Model default';
			}
			return {
				name: sentenceCaseLabel(param.label),
				control: {
					type: 'dropdown' as const,
					key: `${OPTION_PREFIX}${kind}:${param.id}`,
					options: choices,
					defaultValue: defaultOption(param),
				},
			};
		});
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
		const option = parseOptionKey(key);
		if (option) {
			const { slug } = selectedModel(this.plugin.settings, option.kind);
			return slug ? this.plugin.settings.modelOptions[slug]?.[option.param] : undefined;
		}
		if (key === 'speechPlainText') return this.plugin.settings.speechPlainText;
		if (isStringKey(key)) return this.plugin.settings[key];
		return undefined;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings;
		const option = parseOptionKey(key);
		if (option) {
			const { slug } = selectedModel(settings, option.kind);
			if (!slug || typeof value !== 'string') return;
			settings.modelOptions[slug] = { ...settings.modelOptions[slug], [option.param]: value };
		} else if (key === 'speechPlainText') {
			if (typeof value === 'boolean') settings.speechPlainText = value;
		} else if (isStringKey(key)) {
			settings[key] = typeof value === 'string' ? value : '';
		} else {
			return;
		}
		await this.plugin.saveSettings();

		if (key === 'imageModel' || key === 'speechModel') {
			// The list of options depends on the model.
			this.update();
		} else if (key === 'imageCustomModel' || key === 'speechCustomModel') {
			this.refreshOptions();
		}
	}
}
