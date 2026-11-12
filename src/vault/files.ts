import type { TaskOutput } from '../wiro/client';

export type MediaKind = 'image' | 'speech';

/** File extensions Obsidian embeds, by content type. */
const IMAGE_TYPES: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/jpg': 'jpg',
	'image/webp': 'webp',
	'image/gif': 'gif',
	'image/avif': 'avif',
	'image/bmp': 'bmp',
	'image/svg+xml': 'svg',
};

const AUDIO_TYPES: Record<string, string> = {
	'audio/mpeg': 'mp3',
	'audio/mp3': 'mp3',
	'audio/wav': 'wav',
	'audio/x-wav': 'wav',
	'audio/wave': 'wav',
	'audio/ogg': 'ogg',
	'audio/flac': 'flac',
	'audio/x-flac': 'flac',
	'audio/mp4': 'm4a',
	'audio/x-m4a': 'm4a',
	'audio/aac': 'm4a',
	'audio/webm': 'webm',
};

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'svg']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'flac', 'm4a', 'webm']);

function extensionFromUrl(url: string): string {
	try {
		const path = new URL(url).pathname;
		const match = /\.([A-Za-z0-9]+)$/.exec(path);
		return match?.[1]?.toLowerCase() ?? '';
	} catch {
		return '';
	}
}

/**
 * The file extension for an output of the given kind, or null when the
 * output is not that kind of file (an LLM text answer, a JSON sidecar and so on).
 */
export function outputExtension(output: TaskOutput, kind: MediaKind): string | null {
	const types = kind === 'image' ? IMAGE_TYPES : AUDIO_TYPES;
	const extensions = kind === 'image' ? IMAGE_EXTENSIONS : AUDIO_EXTENSIONS;
	const contentType = output.contentType.split(';')[0]?.trim().toLowerCase() ?? '';
	const byType = types[contentType];
	if (byType) return byType;
	if (contentType && !contentType.startsWith(kind === 'image' ? 'image/' : 'audio/') && contentType !== 'application/octet-stream') {
		return null;
	}
	const byUrl = extensionFromUrl(output.url) || extensionFromUrl(`https://x/${output.name}`);
	if (extensions.has(byUrl)) return byUrl === 'jpeg' ? 'jpg' : byUrl;
	return null;
}

/** Only files on Wiro AI's own hosts are downloaded. */
export function isWiroFileUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === 'https:' && (parsed.hostname === 'wiro.ai' || parsed.hostname.endsWith('.wiro.ai'));
	} catch {
		return false;
	}
}

/** Local time as YYYYMMDDHHmmss, the stamp Obsidian uses for pasted images. */
export function fileStamp(date: Date = new Date()): string {
	const pad = (value: number) => String(value).padStart(2, '0');
	return (
		`${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
		`${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
	);
}

/**
 * The file name for a result, in the style of Obsidian's "Pasted image"
 * names: "Wiro image 20261111153012.png", with " 2", " 3" for the next files
 * of the same run.
 */
export function outputFileName(kind: MediaKind, stamp: string, index: number, extension: string): string {
	const label = kind === 'image' ? 'Wiro image' : 'Wiro speech';
	return `${label} ${stamp}${index > 0 ? ` ${index + 1}` : ''}.${extension}`;
}

/** Splits "folder/name.ext" into "folder/name" and "ext". */
export function splitExtension(path: string): { base: string; extension: string } {
	const dot = path.lastIndexOf('.');
	const slash = path.lastIndexOf('/');
	if (dot <= slash + 1) return { base: path, extension: '' };
	return { base: path.slice(0, dot), extension: path.slice(dot + 1) };
}
