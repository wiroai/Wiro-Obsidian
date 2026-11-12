import type { StartedTask, TaskOutput, TaskState, WiroClient } from './client';
import { TaskCancelledError, TaskFailedError, TaskTimeoutError, WiroApiError } from './errors';

/** Statuses that end a task (https://wiro.ai/docs/tasks). */
const FINAL_STATUSES = new Set(['task_postprocess_end', 'task_cancel']);

/** Statuses before a worker picks the task up, when Task/Cancel applies instead of Task/Kill. */
const QUEUED_STATUSES = new Set(['task_queue', 'task_accept', 'task_preprocess_start', 'task_preprocess_end']);

/** Error code of a run refused because the project is at its concurrency limit. No task is created. */
const CONCURRENCY_LIMIT = 96;

/** Error code of a run refused for lack of balance. */
const NO_BALANCE = 97;

/** What the user sees while a task runs. */
export type TaskPhase = 'starting' | 'waiting' | 'queued' | 'running' | 'finishing';

export function phaseOf(status: string): TaskPhase {
	if (QUEUED_STATUSES.has(status)) return 'queued';
	if (status.startsWith('task_postprocess') || status === 'task_end') return 'finishing';
	return 'running';
}

export interface FinishedTask {
	taskId: string;
	outputs: TaskOutput[];
	/** The merged text of an LLM or speech-to-text answer, when the model returns text. */
	debugOutput: string;
	totalCost: string;
	elapsedSeconds: string;
}

export interface RunTaskOptions {
	signal?: AbortSignal;
	onPhase?: (phase: TaskPhase) => void;
	onStarted?: (task: StartedTask) => void;
	/**
	 * Asked when `signal` aborts: true (the default) stops the task on Wiro AI,
	 * false only stops waiting for it.
	 */
	shouldStop?: () => boolean;
	/** Gives up after this long, and stops the task. Default: 15 minutes. */
	timeoutMs?: number;
	/** First wait between Task/Detail calls; it grows to five times this. Default: 2 seconds. */
	pollMs?: number;
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
	now?: () => number;
}

/** Waits `ms`, or rejects with TaskCancelledError as soon as `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new TaskCancelledError());
			return;
		}
		const onAbort = () => {
			window.clearTimeout(timer);
			reject(new TaskCancelledError());
		};
		const timer = window.setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

/** Turns API errors into messages that tell the user what to do. */
export function explainRunError(error: unknown, slug: string): unknown {
	if (!(error instanceof WiroApiError)) return error;
	let message = error.message;
	if (/slug-owner-project-not-exist|tool-not-accessible/.test(message)) {
		message = `There is no model "${slug}" that this project can run. Check the model ID on wiro.ai/models.`;
	} else if (error.code === NO_BALANCE) {
		message = `${message.replace(/\.$/, '')}. Add funds at wiro.ai/panel/billing.`;
	} else if (error.status === 401 || /authorization is not found/i.test(message)) {
		message = 'The API key was not accepted. Check the key in the plugin settings, and the API secret if the project uses signature-based authentication.';
	}
	return new WiroApiError(message, { code: error.code, status: error.status, retryable: error.retryable });
}

/**
 * Stops a task: Task/Cancel while it is queued, Task/Kill once it runs, and
 * the other one if the first is refused. Returns false if neither worked.
 */
export async function stopTask(client: WiroClient, task: StartedTask, status: string): Promise<boolean> {
	const cancel = () => client.cancel(task.taskId);
	const kill = () => client.kill(task.token);
	const attempts = !status || QUEUED_STATUSES.has(status) ? [cancel, kill] : [kill, cancel];
	for (const attempt of attempts) {
		try {
			await attempt();
			return true;
		} catch {
			// Try the other call.
		}
	}
	return false;
}

function failureMessage(state: TaskState): string {
	const detail = state.debugError.trim();
	const tail = detail.length > 600 ? `…${detail.slice(-600)}` : detail;
	return `The model run failed (task ${state.id || 'unknown'}${state.pexit ? `, exit code ${state.pexit}` : ''})${tail ? `: ${tail}` : '.'}`;
}

/**
 * Runs a model and waits for it: Run, then Task/Detail until the task ends.
 * Throws TaskCancelledError when `signal` aborts (the task is stopped first),
 * TaskFailedError when the model fails and TaskTimeoutError on timeout.
 */
export async function runTask(
	client: WiroClient,
	slug: string,
	params: Record<string, unknown>,
	options: RunTaskOptions = {},
): Promise<FinishedTask> {
	const wait = options.sleep ?? sleep;
	const now = options.now ?? Date.now;
	const timeoutMs = options.timeoutMs ?? 15 * 60_000;
	const pollMs = options.pollMs ?? 2_000;
	const deadline = now() + timeoutMs;
	const { signal } = options;
	const stopOnAbort = options.shouldStop ?? (() => true);

	// Start the run. A concurrency refusal creates no task, so it is tried again.
	options.onPhase?.('starting');
	let started: StartedTask | undefined;
	let retryWait = 5_000;
	while (!started) {
		if (signal?.aborted) throw new TaskCancelledError();
		try {
			started = await client.run(slug, params);
		} catch (error) {
			if (error instanceof WiroApiError && error.code === CONCURRENCY_LIMIT && now() + retryWait < deadline) {
				options.onPhase?.('waiting');
				await wait(retryWait, signal);
				retryWait = Math.min(retryWait * 2, 60_000);
				continue;
			}
			throw explainRunError(error, slug);
		}
	}
	options.onStarted?.(started);

	let status = '';
	let phase: TaskPhase = 'starting';
	let failures = 0;
	let interval = pollMs;
	for (;;) {
		if (signal?.aborted) {
			if (stopOnAbort()) await stopTask(client, started, status);
			throw new TaskCancelledError();
		}

		let state: TaskState | null = null;
		try {
			state = await client.taskDetail(started.token);
			failures = 0;
		} catch (error) {
			if (error instanceof WiroApiError && (error.status === 401 || error.status === 403)) throw explainRunError(error, slug);
			failures += 1;
			if (failures >= 10) throw error;
		}

		if (state?.status && state.status !== status) {
			status = state.status;
			const next = phaseOf(status);
			if (next !== phase) {
				phase = next;
				options.onPhase?.(phase);
			}
		}
		if (state && FINAL_STATUSES.has(state.status)) {
			if (state.status === 'task_cancel') throw new TaskCancelledError('The task was cancelled.');
			if (state.pexit !== '0') throw new TaskFailedError(failureMessage(state));
			return {
				taskId: state.id || started.taskId,
				outputs: state.outputs,
				debugOutput: state.debugOutput,
				totalCost: state.totalCost,
				elapsedSeconds: state.elapsedSeconds,
			};
		}

		if (now() >= deadline) {
			const stopped = await stopTask(client, started, status);
			throw new TaskTimeoutError(
				`Task ${started.taskId} did not finish in ${Math.round(timeoutMs / 60_000)} minutes.` +
					(stopped ? ' It was stopped.' : ' It could not be stopped, so it may still finish on Wiro AI.'),
			);
		}
		try {
			await wait(Math.min(interval, Math.max(0, deadline - now())), signal);
		} catch (error) {
			if (error instanceof TaskCancelledError && stopOnAbort()) {
				await stopTask(client, started, status);
			}
			throw error;
		}
		interval = Math.min(interval + 1_000, pollMs * 5);
	}
}

/** Formats a USD amount such as "0.033600000000" as "$0.0336". */
export function formatCost(totalCost: string): string {
	const amount = Number(totalCost);
	if (!totalCost || !Number.isFinite(amount)) return '';
	if (amount === 0) return '$0';
	const digits = amount >= 0.01 ? 4 : 6;
	return `$${amount.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '')}`;
}
