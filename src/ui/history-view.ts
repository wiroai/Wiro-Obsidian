import { ButtonComponent, ItemView, TFile, type WorkspaceLeaf } from 'obsidian';
import { modelName } from '../catalog';
import type { HistoryEntry } from '../settings';
import type { Credentials } from '../wiro/auth';
import type { TaskSummary, WiroClient } from '../wiro/client';
import { errorMessage } from '../wiro/errors';
import { formatCost } from '../wiro/task';

export const HISTORY_VIEW = 'wiro-ai-history';

/** What the history view reads from the plugin. */
export interface HistoryHost {
	history(): HistoryEntry[];
	credentials(): Credentials | null;
	client(credentials: Credentials): WiroClient;
}

function timeAgo(at: number): string {
	const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
	if (seconds < 60) return 'just now';
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} h ago`;
	return new Date(at).toLocaleDateString();
}

function statusText(task: TaskSummary): string {
	if (task.status === 'task_cancel') return 'cancelled';
	if (task.status === 'task_postprocess_end') return task.pexit === '0' ? 'done' : 'failed';
	return 'running';
}

/** Recent runs: the ones saved in this vault, and the project's latest tasks on Wiro AI. */
export class HistoryView extends ItemView {
	private tasks: TaskSummary[] | null = null;
	private tasksError = '';

	constructor(
		leaf: WorkspaceLeaf,
		private readonly host: HistoryHost,
	) {
		super(leaf);
	}

	getViewType(): string {
		return HISTORY_VIEW;
	}

	getDisplayText(): string {
		return 'Wiro AI history';
	}

	getIcon(): string {
		return 'history';
	}

	async onOpen(): Promise<void> {
		this.render();
		await this.loadTasks();
	}

	/** Redraws the list, for example after a run finished. */
	refresh(): void {
		this.render();
	}

	private async loadTasks(): Promise<void> {
		const credentials = this.host.credentials();
		if (!credentials) {
			this.tasks = null;
			this.tasksError = 'Add your API key in the plugin settings to see the runs of your Wiro AI project.';
			this.render();
			return;
		}
		try {
			this.tasks = await this.host.client(credentials).taskList(20);
			this.tasksError = '';
		} catch (error) {
			this.tasksError = errorMessage(error);
		}
		this.render();
	}

	private render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass('wiro-history');
		const header = root.createDiv({ cls: 'wiro-history-header' });
		header.createEl('h4', { text: 'Saved in this vault' });
		new ButtonComponent(header).setIcon('refresh-cw').setTooltip('Refresh').onClick(() => {
			this.render();
			void this.loadTasks();
		});

		const entries = this.host.history();
		if (entries.length === 0) root.createDiv({ cls: 'wiro-muted', text: 'Runs you start from this vault show up here.' });
		for (const entry of entries) {
			const row = root.createDiv({ cls: 'wiro-history-row' });
			const top = row.createDiv({ cls: 'wiro-history-top' });
			top.createSpan({ cls: 'wiro-history-title', text: entry.label });
			top.createSpan({ cls: 'wiro-muted', text: timeAgo(entry.at) });
			const details = [modelName(entry.model), entry.costUsd !== undefined ? formatCost(String(entry.costUsd)) : ''].filter(Boolean).join(' · ');
			row.createDiv({ cls: 'wiro-muted', text: details });
			for (const path of [...entry.files, ...(entry.note ? [entry.note] : [])]) {
				const file = this.app.vault.getFileByPath(path);
				if (!(file instanceof TFile)) continue;
				const link = row.createEl('a', { cls: 'wiro-history-link', text: file.name, href: '#' });
				link.addEventListener('click', (event) => {
					event.preventDefault();
					void this.app.workspace.getLeaf(false).openFile(file);
				});
			}
		}

		root.createEl('h4', { text: 'Latest runs on Wiro AI' });
		if (this.tasksError) {
			root.createDiv({ cls: 'wiro-muted', text: this.tasksError });
			return;
		}
		if (this.tasks === null) {
			root.createDiv({ cls: 'wiro-muted', text: 'Loading…' });
			return;
		}
		if (this.tasks.length === 0) root.createDiv({ cls: 'wiro-muted', text: 'No runs yet.' });
		for (const task of this.tasks) {
			const row = root.createDiv({ cls: 'wiro-history-row' });
			const top = row.createDiv({ cls: 'wiro-history-top' });
			top.createSpan({ cls: 'wiro-history-title', text: task.slug || `Task ${task.id}` });
			top.createSpan({ cls: 'wiro-muted', text: task.createdAt ? timeAgo(task.createdAt) : '' });
			const cost = formatCost(task.totalCost);
			row.createDiv({ cls: 'wiro-muted', text: [statusText(task), cost].filter(Boolean).join(' · ') });
			for (const output of task.outputs.filter((entry) => entry.url).slice(0, 4)) {
				row.createEl('a', { cls: 'wiro-history-link', text: output.name || 'output', href: output.url });
			}
		}
	}
}
