import { EXTENSIONS, kindOfExtension, type MediaKind } from './files';

/** An embed in a note: ![[file.png]] or ![alt](file.png). */
export interface EmbedRef {
	/** The link target as written, without a subpath or size. */
	target: string;
	/** Zero-based line of the embed. */
	line: number;
	kind: MediaKind;
	/** The file extension in lower case. */
	extension: string;
}

function extensionOf(target: string): string {
	const clean = target.split(/[?#]/)[0] ?? target;
	const dot = clean.lastIndexOf('.');
	return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : '';
}

/**
 * Whether an embed can be used where a file of `kind` is needed. A .webm file
 * counts as audio too: Obsidian's audio recorder saves recordings as .webm.
 */
export function embedFits(embed: EmbedRef, kind: MediaKind): boolean {
	return embed.kind === kind || (kind === 'audio' && EXTENSIONS.audio.has(embed.extension));
}

/** Every image, audio and video embed in a note, in order. */
export function findEmbeds(markdown: string): EmbedRef[] {
	const embeds: EmbedRef[] = [];
	const lines = markdown.split('\n');
	lines.forEach((text, line) => {
		for (const match of text.matchAll(/!\[\[([^\]|#^\n]+)(?:[#^][^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g)) {
			const target = (match[1] ?? '').trim();
			const extension = extensionOf(target);
			const kind = kindOfExtension(extension);
			if (target && kind) embeds.push({ target, line, kind, extension });
		}
		for (const match of text.matchAll(/!\[[^\]\n]*\]\(\s*<?([^)>\s]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
			const raw = match[1] ?? '';
			if (/^[a-z]+:\/\//i.test(raw)) continue;
			let target = raw;
			try {
				target = decodeURIComponent(raw);
			} catch {
				// Keep the link as written.
			}
			const extension = extensionOf(target);
			const kind = kindOfExtension(extension);
			if (target && kind) embeds.push({ target, line, kind, extension });
		}
	});
	return embeds;
}
