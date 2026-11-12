import { bundledSchema } from './catalog';
import type { WiroClient } from './wiro/client';
import { errorMessage } from './wiro/errors';
import type { ModelSchema } from './wiro/schema';

/** How long a run waits for the live parameters before it uses the bundled ones. */
const RUN_LOOKUP_TIMEOUT_MS = 10_000;

/**
 * Model parameters from Tool/Detail, loaded once per session. Settings show
 * the bundled copy for listed models; runs use the live copy when they can.
 */
export class SchemaCache {
	private readonly live = new Map<string, ModelSchema>();
	private readonly pending = new Map<string, Promise<ModelSchema>>();
	private readonly errors = new Map<string, string>();

	constructor(private readonly client: () => WiroClient) {}

	/** What is known now: the live parameters, else the bundled ones. */
	peek(slug: string): ModelSchema | null {
		return this.live.get(slug) ?? bundledSchema(slug);
	}

	/** The error of the last failed load, if any. */
	error(slug: string): string | undefined {
		return this.errors.get(slug);
	}

	isLoading(slug: string): boolean {
		return this.pending.has(slug);
	}

	/** Loads the live parameters; concurrent calls share one request. */
	load(slug: string): Promise<ModelSchema> {
		const cached = this.live.get(slug);
		if (cached) return Promise.resolve(cached);
		let request = this.pending.get(slug);
		if (!request) {
			this.errors.delete(slug);
			request = this.client()
				.toolDetail(slug)
				.then((schema) => {
					this.live.set(slug, schema);
					return schema;
				})
				.catch((error: unknown) => {
					this.errors.set(slug, errorMessage(error));
					throw error;
				})
				.finally(() => this.pending.delete(slug));
			this.pending.set(slug, request);
		}
		return request;
	}

	/**
	 * The parameters a run should use: the live ones, or the bundled ones when
	 * Tool/Detail is slow or fails. Null when neither is known.
	 */
	async forRun(slug: string): Promise<ModelSchema | null> {
		let timer = 0;
		const timeout = new Promise<null>((resolve) => {
			timer = window.setTimeout(() => resolve(null), RUN_LOOKUP_TIMEOUT_MS);
		});
		try {
			const schema = await Promise.race([this.load(slug).catch(() => null), timeout]);
			return schema ?? bundledSchema(slug);
		} finally {
			window.clearTimeout(timer);
		}
	}
}
