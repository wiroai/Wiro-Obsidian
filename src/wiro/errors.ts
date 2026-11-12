/** An error answer from the Wiro AI API, or a request that never got one. */
export class WiroApiError extends Error {
	readonly code: number | undefined;
	readonly status: number | undefined;
	readonly retryable: boolean;

	constructor(message: string, options: { code?: number; status?: number; retryable?: boolean } = {}) {
		super(message);
		this.name = 'WiroApiError';
		this.code = options.code;
		this.status = options.status;
		this.retryable = options.retryable ?? false;
	}
}

/** The user stopped the run, or the task was cancelled on the Wiro AI side. */
export class TaskCancelledError extends Error {
	constructor(message = 'Cancelled.') {
		super(message);
		this.name = 'TaskCancelledError';
	}
}

/** The model ran but did not succeed (a non-zero exit code). */
export class TaskFailedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TaskFailedError';
	}
}

/** The task did not finish in time. */
export class TaskTimeoutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TaskTimeoutError';
	}
}

/** A message that is safe and useful to show the user. */
export function errorMessage(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === 'string' && error) return error;
	return 'Something went wrong.';
}
