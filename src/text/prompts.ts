import type { ChatMessage } from '../wiro/gateway';

export type TextAction = 'summarize' | 'rewrite' | 'translate' | 'continue' | 'ask';

const KEEP_FORMAT = 'Keep the Markdown formatting, links, wikilinks and line breaks.';

/** The messages sent to the LLM gateway for one text action. */
export function textMessages(action: TextAction, text: string, extra = ''): ChatMessage[] {
	switch (action) {
		case 'summarize':
			return [
				{
					role: 'system',
					content:
						'You summarize notes. Reply with the summary only, as a few short Markdown bullet points, in the same language as the text.',
				},
				{ role: 'user', content: text },
			];
		case 'rewrite':
			return [
				{
					role: 'system',
					content: `Rewrite the text so it is clearer and reads well. Keep its meaning, language and tone. ${KEEP_FORMAT} Reply with the rewritten text only.`,
				},
				{ role: 'user', content: text },
			];
		case 'translate':
			return [
				{
					role: 'system',
					content: `Translate the text into ${extra || 'English'}. ${KEEP_FORMAT} Reply with the translation only.`,
				},
				{ role: 'user', content: text },
			];
		case 'continue':
			return [
				{
					role: 'system',
					content:
						'Continue the text from where it stops, in the same language, style and format. Write one or two paragraphs. Reply with the new text only, without repeating what is already there.',
				},
				{ role: 'user', content: text },
			];
		case 'ask':
			return [
				{
					role: 'system',
					content:
						'Answer the question using the note. If the note does not contain the answer, say so in one sentence. Reply in the language of the question, in Markdown.',
				},
				{ role: 'user', content: `Note:\n\n${text}\n\nQuestion: ${extra}` },
			];
	}
}

/** The last part of a long text, cut at a paragraph or line break when possible. */
export function tail(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const slice = text.slice(text.length - maxChars);
	const paragraph = slice.indexOf('\n\n');
	if (paragraph >= 0 && paragraph < maxChars / 3) return slice.slice(paragraph + 2);
	const line = slice.indexOf('\n');
	return line >= 0 && line < maxChars / 3 ? slice.slice(line + 1) : slice;
}
