import type { TaskOutput } from '../wiro/client';

export type MediaKind = 'image' | 'audio' | 'video';

/** File extensions Obsidian embeds, by content type. */
const TYPES: Record<MediaKind, Record<string, string>> = {
	image: {
		'image/png': 'png',
		'image/jpeg': 'jpg',
		'image/jpg': 'jpg',
		'image/webp': 'webp',
		'image/gif': 'gif',
		'image/avif': 'avif',
		'image/bmp': 'bmp',
		'image/svg+xml': 'svg',
	},
	audio: {
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
	},
	video: {
		'video/mp4': 'mp4',
		'video/webm': 'webm',
		'video/quicktime': 'mov',
		'video/x-matroska': 'mkv',
		'video/ogg': 'ogv',
	},
};

export const EXTENSIONS: Record<MediaKind, Set<string>> = {
	image: new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'svg']),
	audio: new Set(['mp3', 'wav', 'ogg', 'flac', 'm4a', 'webm', '3gp']),
	video: new Set(['mp4', 'webm', 'mov', 'mkv', 'ogv']),
};

/** MIME types for uploading vault files, by extension. */
const MIME: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	gif: 'image/gif',
	avif: 'image/avif',
	bmp: 'image/bmp',
	svg: 'image/svg+xml',
	mp3: 'audio/mpeg',
	wav: 'audio/wav',
	ogg: 'audio/ogg',
	flac: 'audio/flac',
	m4a: 'audio/mp4',
	'3gp': 'audio/3gpp',
	mp4: 'video/mp4',
	webm: 'video/webm',
	mov: 'video/quicktime',
	mkv: 'video/x-matroska',
	ogv: 'video/ogg',
	pdf: 'application/pdf',
	txt: 'text/plain',
	md: 'text/markdown',
};

export function mimeType(extension: string): string {
	return MIME[extension.toLowerCase()] ?? 'application/octet-stream';
}

/** The media kind of a vault file, by its extension. */
export function kindOfExtension(extension: string): MediaKind | null {
	const lower = extension.toLowerCase();
	// webm is both; a .webm attachment is treated as video, as Obsidian does.
	if (EXTENSIONS.video.has(lower)) return 'video';
	if (EXTENSIONS.image.has(lower)) return 'image';
	if (EXTENSIONS.audio.has(lower)) return 'audio';
	return null;
}

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
	const contentType = output.contentType.split(';')[0]?.trim().toLowerCase() ?? '';
	const byType = TYPES[kind][contentType];
	if (byType) return byType;
	if (contentType && !contentType.startsWith(`${kind}/`) && contentType !== 'application/octet-stream') {
		return null;
	}
	const byUrl = extensionFromUrl(output.url) || extensionFromUrl(`https://x/${output.name}`);
	if (EXTENSIONS[kind].has(byUrl)) return byUrl === 'jpeg' ? 'jpg' : byUrl;
	return null;
}

/** The media kind of an output file, or null for text and other files. */
export function outputKind(output: TaskOutput): MediaKind | null {
	for (const kind of ['image', 'video', 'audio'] as const) {
		if (outputExtension(output, kind)) return kind;
	}
	return null;
}

/** Text outputs: plain text, JSON, subtitles and Markdown files. */
export function isTextOutput(output: TaskOutput): boolean {
	const contentType = output.contentType.split(';')[0]?.trim().toLowerCase() ?? '';
	if (contentType.startsWith('text/') || contentType === 'application/json') return true;
	const extension = extensionFromUrl(output.url) || extensionFromUrl(`https://x/${output.name}`);
	return ['txt', 'json', 'srt', 'vtt', 'md', 'csv'].includes(extension);
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
export function outputFileName(label: string, stamp: string, index: number, extension: string): string {
	return `${label} ${stamp}${index > 0 ? ` ${index + 1}` : ''}.${extension}`;
}

/**
 * A name for an upload. Wiro storage refuses a second file with the same name,
 * so each upload gets the time in front of the vault file's name.
 */
export function uploadName(fileName: string, now: number = Date.now()): string {
	const clean = fileName.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-(?=\.)/g, '');
	return `obsidian-${now.toString(36)}-${clean || 'file'}`;
}

/** Splits "folder/name.ext" into "folder/name" and "ext". */
export function splitExtension(path: string): { base: string; extension: string } {
	const dot = path.lastIndexOf('.');
	const slash = path.lastIndexOf('/');
	if (dot <= slash + 1) return { base: path, extension: '' };
	return { base: path.slice(0, dot), extension: path.slice(dot + 1) };
}
