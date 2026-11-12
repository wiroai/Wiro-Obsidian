import type { TaskOutput } from './client';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The text answer of a task: the answer segments of a "raw" output (LLMs),
 * else the merged `debugoutput` when the task returned no files.
 */
export function answerText(task: { outputs: TaskOutput[]; debugOutput: string }): string {
	const debugOutput = task.debugOutput.trim();
	const raw = task.outputs.find((output) => output.contentType === 'raw' && output.content !== undefined);
	if (raw) {
		const content = raw.content;
		if (typeof content === 'string' && content.trim()) return content.trim();
		if (isRecord(content)) {
			const segments = Array.isArray(content.segments) ? (content.segments as unknown[]) : [];
			const answer = segments
				.filter(isRecord)
				.filter((segment) => segment.type === 'answer' && typeof segment.text === 'string')
				.map((segment) => String(segment.text))
				.join('')
				.trim();
			if (answer) return answer;
			if (Array.isArray(content.answer)) {
				const joined = (content.answer as unknown[]).filter((part) => typeof part === 'string').join('').trim();
				if (joined) return joined;
			}
			if (typeof content.raw === 'string' && content.raw.trim()) return content.raw.trim();
		}
		return debugOutput;
	}
	if (task.outputs.some((output) => output.url)) return '';
	return debugOutput;
}

/** The text of a transcript file: plain text as is, JSON by its "text" or segment texts. */
export function transcriptText(body: string): string {
	const trimmed = body.trim();
	if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return trimmed;
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return trimmed;
	}
	if (isRecord(parsed) && typeof parsed.text === 'string') return parsed.text.trim();
	const list = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.segments) ? parsed.segments : null;
	if (list) {
		const texts = (list as unknown[]).filter(isRecord).map((entry) => (typeof entry.text === 'string' ? entry.text.trim() : ''));
		const joined = texts.filter(Boolean).join(' ');
		if (joined) return joined;
	}
	return trimmed;
}
