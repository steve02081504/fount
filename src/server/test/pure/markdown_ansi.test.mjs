/* global Deno */
import { assert, assertNotMatch } from 'jsr:@std/assert'
import stripAnsi from 'npm:strip-ansi'

import { renderMarkdownAnsi } from '../../../scripts/markdown_ansi.mjs'

Deno.test('terminal Markdown renders tables, emphasis and highlighted code without a server TTY', () => {
	const result = renderMarkdownAnsi('**粗体** *斜体*\n\n|名称|值|\n|---|---|\n|中文|2|\n\n```js\nconst answer = 42;\n```')
	const plain = stripAnsi(result)
	assert(result.includes('\x1b[1m粗体\x1b[22m'))
	assert(result.includes('\x1b[3m斜体\x1b[23m'))
	assert(result.includes('\x1b[34mconst'))
	assert(plain.includes('┌'))
	assert(plain.includes('中文'))
	assert(plain.includes('const answer = 42;'))
})

Deno.test('terminal Markdown supports plain output and unknown code languages', () => {
	const markdown = '**bold**\n\n```unknown-language\n<x> & y\n```'
	const result = renderMarkdownAnsi(markdown, { ansi: false })
	assertNotMatch(result, /\x1b\[/)
	assert(result.includes('bold'))
	assert(result.includes('<x> & y'))
})

Deno.test('terminal Markdown honours the client width', () => {
	const result = renderMarkdownAnsi(`**${'wide '.repeat(20)}**`, { width: 24, ansi: false })
	assert(Math.max(...result.split('\n').map(line => line.length)) <= 24)
})
