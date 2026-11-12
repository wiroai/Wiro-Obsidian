/** A short random id, so two runs in one note get different placeholders. */
export function placeholderId(): string {
	return Math.random().toString(36).slice(2, 8).padEnd(6, '0');
}

/** "%%Wiro AI is generating an image (k3j9x2)%%" for the label "generating an image". */
export function placeholderText(label: string, id: string = placeholderId()): string {
	return `%%Wiro AI is ${label} (${id})%%`;
}

/** The line a block goes on at the top of a note: after the front matter, if there is one. */
export function topLine(lines: string[]): number {
	if (lines[0]?.trim() !== '---') return 0;
	const end = lines.findIndex((line, index) => index > 0 && (line.trim() === '---' || line.trim() === '...'));
	return end > 0 ? end + 1 : 0;
}

/**
 * Where and how to insert a block for the line the cursor or selection ends
 * on, so the result becomes its own paragraph: on an empty line it goes on
 * that line, otherwise after the line, with blank lines around it.
 */
export function planInsertion(
	line: string,
	previousLine: string | null,
	nextLine: string | null,
	block: string,
): { ch: number; text: string } {
	const suffix = nextLine !== null && nextLine.trim() !== '' ? '\n' : '';
	if (line.trim() === '') {
		const prefix = previousLine !== null && previousLine.trim() !== '' ? '\n' : '';
		return { ch: line.length, text: `${prefix}${block}${suffix}` };
	}
	return { ch: line.length, text: `\n\n${block}${suffix}` };
}
