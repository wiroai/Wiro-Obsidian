import { Notice } from 'obsidian';
import type { TaskPhase } from '../wiro/task';

export type JobPhase = TaskPhase | 'saving';

const PHASE_TEXT: Record<JobPhase, string> = {
	starting: 'Starting',
	waiting: 'Waiting for a free slot',
	queued: 'In the queue',
	running: 'Running',
	finishing: 'Finishing',
	saving: 'Saving to the vault',
};

/** A notice that stays up while a task runs, with its phase, the elapsed time and a cancel button. */
export class ProgressNotice {
	private readonly notice: Notice;
	private readonly statusEl: HTMLElement;
	private readonly startedAt = Date.now();
	private readonly timer: number;
	private phase: JobPhase = 'starting';
	private closed = false;

	constructor(title: string, onCancel: () => void) {
		this.notice = new Notice('', 0);
		const el = this.notice.messageEl;
		el.empty();
		el.addClass('wiro-progress');
		const text = el.createDiv({ cls: 'wiro-progress-text' });
		text.createDiv({ cls: 'wiro-progress-title', text: title });
		this.statusEl = text.createDiv({ cls: 'wiro-progress-status' });
		const button = el.createEl('button', { cls: 'wiro-progress-cancel', text: 'Cancel' });
		button.addEventListener('click', (event) => {
			// Keep the click from also closing the notice before the run stops.
			event.stopPropagation();
			button.disabled = true;
			button.setText('Cancelling');
			onCancel();
		});
		this.render();
		this.timer = window.setInterval(() => this.render(), 1000);
	}

	setPhase(phase: JobPhase): void {
		this.phase = phase;
		this.render();
	}

	private render(): void {
		if (this.closed) return;
		const seconds = Math.floor((Date.now() - this.startedAt) / 1000);
		this.statusEl.setText(`${PHASE_TEXT[this.phase]} · ${seconds} s`);
	}

	hide(): void {
		if (this.closed) return;
		this.closed = true;
		window.clearInterval(this.timer);
		this.notice.hide();
	}
}
