/**
 * Turns Markdown into the plain text a voice should read: link text instead
 * of URLs, no formatting marks, no embeds, code or comments. Paragraphs stay
 * on their own lines so the voice pauses between them.
 */
export function markdownToSpeechText(markdown: string): string {
	let text = markdown.replace(/\r\n?/g, '\n');

	// Front matter, comments, code blocks and HTML.
	text = text.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '');
	text = text.replace(/%%[\s\S]*?%%/g, ' ');
	text = text.replace(/<!--[\s\S]*?-->/g, ' ');
	text = text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, ' ');
	text = text.replace(/<[^>\n]+>/g, ' ');

	// Embeds go, links keep their text.
	text = text.replace(/!\[\[[^\]\n]*\]\]/g, ' ');
	text = text.replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, ' ');
	text = text.replace(/\[\[([^\]|\n]+)\|([^\]\n]+)\]\]/g, '$2');
	text = text.replace(/\[\[([^\]\n]+)\]\]/g, (_match, target: string) => {
		const withoutHeading = target.split('#')[0] ?? target;
		const name = withoutHeading.split('/').pop() ?? withoutHeading;
		return name || target.replace(/^#+/, '');
	});
	text = text.replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, '$1');
	text = text.replace(/\[\^[^\]\n]+\]/g, '');
	text = text.replace(/https?:\/\/\S+/g, ' ');

	// Line-level marks: headings, quotes and callouts, lists, tasks, rules, tables.
	text = text.replace(/^[ \t]*>[ \t]*\[![^\]\n]+\][-+]?[ \t]*/gm, '');
	text = text.replace(/^[ \t]*(?:>[ \t]?)+/gm, '');
	text = text.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
	text = text.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, '');
	text = text.replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, '');
	text = text.replace(/^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*:?-*:?[ \t]*$/gm, '');
	text = text.replace(/[ \t]*\|[ \t]*/g, ', ');

	// Inline marks.
	text = text.replace(/`([^`\n]*)`/g, '$1');
	// Underscores only mark emphasis at word edges, so snake_case stays as it is.
	text = text.replace(/\*\*(\S(?:[^\n]*?\S)?)\*\*/g, '$1');
	text = text.replace(/(^|\W)__(\S(?:[^\n]*?\S)?)__(?=\W|$)/gm, '$1$2');
	text = text.replace(/\*(\S(?:[^\n]*?\S)?)\*/g, '$1');
	text = text.replace(/(^|\W)_(\S(?:[^\n]*?\S)?)_(?=\W|$)/gm, '$1$2');
	text = text.replace(/~~(\S(?:[^\n]*?\S)?)~~/g, '$1');
	text = text.replace(/==(\S(?:[^\n]*?\S)?)==/g, '$1');
	text = text.replace(/(^|\s)#([A-Za-z][\w/-]*)/g, '$1$2');
	text = text.replace(/\s\^[A-Za-z0-9-]+$/gm, '');

	// Tidy the whitespace.
	text = text
		.split('\n')
		.map((line) =>
			line
				.replace(/[ \t]+/g, ' ')
				.replace(/ ([.,;:!?])/g, '$1')
				.replace(/^, |, $/g, '')
				.trim(),
		)
		.join('\n');
	return text.replace(/\n{3,}/g, '\n\n').trim();
}
