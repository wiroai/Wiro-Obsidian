import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markdownToSpeechText } from '../src/text/speech-text';

test('links keep their text and lose their URLs', () => {
	assert.equal(
		markdownToSpeechText('Read [the docs](https://wiro.ai/docs) and [[Projects/Plan#Goals|our plan]] or [[Ideas]].'),
		'Read the docs and our plan or Ideas.',
	);
	assert.equal(markdownToSpeechText('See https://wiro.ai for more.'), 'See for more.');
	assert.equal(markdownToSpeechText('The answer is ![[chart.png]].'), 'The answer is.');
});

test('formatting marks go, the words stay', () => {
	assert.equal(
		markdownToSpeechText('This is **bold**, *italic*, __strong__, _soft_, ~~old~~, ==marked== and `code`.'),
		'This is bold, italic, strong, soft, old, marked and code.',
	);
	assert.equal(markdownToSpeechText('Keep snake_case_names and 2 * 3 * 4 as they are.'), 'Keep snake_case_names and 2 * 3 * 4 as they are.');
});

test('headings, lists, tasks and quotes read as plain lines', () => {
	const markdown = ['# Trip', '', '- [ ] Pack the bags', '- [x] Book the train', '1. Leave early', '> [!note] Remember', '> Take water'].join('\n');
	assert.equal(markdownToSpeechText(markdown), ['Trip', '', 'Pack the bags', 'Book the train', 'Leave early', 'Remember', 'Take water'].join('\n'));
});

test('embeds, code blocks, comments, HTML and front matter are skipped', () => {
	const markdown = [
		'---',
		'tags: [a]',
		'---',
		'Before ![[photo.png]] and ![alt](pic.png).',
		'```js',
		'console.log(1);',
		'```',
		'%%private note%%After <span>this</span>.',
		'Footnote[^1] and #tag here. ^block-1',
	].join('\n');
	// The code block leaves a blank line, so the voice pauses there.
	assert.equal(markdownToSpeechText(markdown), ['Before and.', '', 'After this.', 'Footnote and tag here.'].join('\n'));
});

test('tables read cell by cell', () => {
	const markdown = ['| Name | Age |', '| --- | --- |', '| Ana | 31 |'].join('\n');
	assert.equal(markdownToSpeechText(markdown), ['Name, Age', '', 'Ana, 31'].join('\n'));
});
