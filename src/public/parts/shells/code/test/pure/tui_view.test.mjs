/* global Deno */
/* eslint jsdoc/require-jsdoc: off, jsdoc/require-param-type: off, jsdoc/require-param-description: off, jsdoc/require-returns: off */
import { strict as assert } from 'node:assert'
import { EventEmitter } from 'node:events'

import { runTui } from '../../cli/tui.mjs'
import { composerView, createTranscriptRenderer, disclosureBlocks, markdownLines, scrollViewport, transcriptView } from '../../cli/view.mjs'

Deno.test('terminal reasoning folds separately, preserves display layer and parses streaming summaries', () => {
	const entries = [{ id: 'a', role: 'char', content: 'hidden agent layer', content_for_show: 'Intro\n<details open><summary><span>Thinking &amp; planning</span></summary>\nprivate thought\n</details>\n# Answer\n- result' }]
	const closed = transcriptView(entries, { width: 70 })
	assert(closed.lines.join('\n').includes('▾ Thinking & planning'))
	assert(!closed.lines.join('\n').includes('private thought'))
	assert(!closed.lines.join('\n').includes('hidden agent layer'))
	assert(closed.lines.join('\n').includes('• result'))
	assert(!closed.lines.join('\n').includes('<details'))
	const opened = transcriptView(entries, { width: 70, expanded: new Set([closed.controls[0].key]) })
	assert(opened.lines.join('\n').includes('private thought'))
	const stream = transcriptView([{ id: 'stream', content: '<details><summary>Thinking</summary>\npartial thought' }], { width: 70 })
	assert.equal(stream.controls.length, 1)
	assert(!stream.lines.join('\n').includes('partial thought'))
	assert.equal(disclosureBlocks('<think>reason</think>answer')[0].children[0].text, 'reason')
})

Deno.test('terminal disclosure parser leaves code examples intact and supports nested blocks', () => {
	// 开栏 3 个反引号、闭栏 4 个（合法的最长匹配）也算闭合，栏后的内联代码仍不透明。
	const fenced = '```html\n<details><summary>example</summary>code</details>\n````\n``<think>``'
	const fencedBlocks = disclosureBlocks(fenced)
	assert.equal(fencedBlocks.length, 1)
	assert.equal(fencedBlocks[0].type, 'text')
	assert.equal(fencedBlocks[0].text.includes('example'), true)
	assert(markdownLines(fenced, 80).join('\n').includes('<details>'))
	const view = transcriptView([{ id: 'a', content: '<details><summary>outer</summary><details><summary>inner</summary>secret</details></details>' }], { width: 50, expanded: new Set(['a:details:0']) })
	assert.equal(view.controls.length, 2)
	assert(!view.lines.join('\n').includes('secret'))
})

Deno.test('terminal viewport stays at bottom without overflow and resumes following when reached', () => {
	assert.deepEqual(scrollViewport(0, 0, -3), { scroll: 0, follow: true })
	assert.deepEqual(scrollViewport(0, 0, 3), { scroll: 0, follow: true })
	assert.deepEqual(scrollViewport(12, 12, -3), { scroll: 9, follow: false })
	assert.deepEqual(scrollViewport(9, 12, 10), { scroll: 12, follow: true })
	const draft = 'first\nsecond\nthird\nfourth\nfifth'
	assert.deepEqual(composerView(draft, 2, 30, 2), { rows: ['first', 'second'], row: 0, column: 'fi' })
	assert.deepEqual(composerView(draft, draft.length, 30, 2), { rows: ['fourth', 'fifth'], row: 1, column: 'fifth' })
})

class Stream extends EventEmitter {
	isRaw = false
	columns = 80
	rows = 24
	writes = []
	setRawMode(value) { this.isRaw = value }
	resume() {}
	pause() {}
	write(value) { this.writes.push(value) }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

Deno.test('terminal reply and task totals use the full localized usage key', async () => {
	const stdin = new Stream(), stdout = new Stream()
	stdout.columns = 160
	const usage = { calls: [{ inputTokens: 12 }], total: { inputTokens: 12 } }
	let receiveEvent
	let refreshed = 0
	const client = {
		state: { session: { usage, entries: [{ id: 'reply', role: 'char', content: 'done', extension: { usage } }] } },
		t: (key, params) => key === 'code.usage.inputTokens' ? `已用输入 ${params.count}` : key,
		loadDraft: async () => '', saveDraft: async () => {},
		subscribeServerEvents: async ({ onEvent }) => { receiveEvent = onEvent },
		refreshSession: async () => { refreshed++ },
	}
	const result = runTui({ client, stdin, stdout })
	try {
		await tick()
		assert(stdout.writes.join('').split('已用输入 12').length >= 3)
		receiveEvent({ type: 'entry', entry: { id: 'notice', role: 'tool', content: 'done', extension: { usage } } })
		assert.equal(refreshed, 1)
	}
	finally { stdin.emit('data', '\x03'); await result }
})

Deno.test('terminal mouse and keyboard expand reasoning, and empty wheel never exposes bottom control', async () => {
	const stdin = new Stream(), stdout = new Stream()
	const client = {
		state: { session: { entries: [] } }, t: key => key,
		loadDraft: async () => '', saveDraft: async () => {}, subscribeServerEvents: async () => {},
	}
	const result = runTui({ client, stdin, stdout })
	try {
		await tick()
		stdin.emit('data', '\x1b[<64;4;5M')
		await tick()
		assert(!stdout.writes.join('').includes('Back to bottom'))
		client.state.session = { entries: [{ id: 'a', role: 'char', content: '<details><summary>Thinking</summary>SECRET</details>\nAnswer' }] }
	} finally { stdin.emit('data', '\x04'); await result }
	const input = new Stream(), output = new Stream()
	const second = runTui({ client, stdin: input, stdout: output })
	try {
		await tick()
		assert(!output.writes.join('').includes('SECRET'))
		input.emit('data', '\x1b[Z\r')
		await tick()
		assert(output.writes.join('').includes('SECRET'))
		output.writes.length = 0
		input.emit('data', '\x1b[<0;5;4M\x1b[<0;5;4m')
		await tick()
		assert(output.writes.join('').includes('▾ Thinking'))
	} finally { input.emit('data', '\x04'); await second }
})

Deno.test('terminal command completion fills the composer without executing, and results remain scrollable', async () => {
	const stdin = new Stream(), stdout = new Stream()
	const commands = []
	const client = {
		state: { session: { entries: [] } }, t: key => key,
		loadDraft: async () => '', saveDraft: async () => {}, subscribeServerEvents: async () => {},
		command: async input => { commands.push(input); return { text: 'line one\nline two\nline three' } },
	}
	const result = runTui({ client, stdin, stdout })
	try {
		await tick()
		stdin.emit('data', '/he\t')
		await tick()
		assert(stdout.writes.join('').includes('/help'))
		stdin.emit('data', '\r')
		await tick()
		assert.deepEqual(commands, [])
		stdin.emit('data', '\r')
		await tick()
		assert.deepEqual(commands, ['/help '])
		assert(stdout.writes.join('').includes('line two'))
		assert.deepEqual(client.state.session.entries, [])
	} finally { stdin.emit('data', '\x03'); await result }
})

Deno.test('terminal draft recovery preserves input typed while the saved draft is loading', async () => {
	const stdin = new Stream(), stdout = new Stream()
	let resolveDraft
	const client = {
		state: { session: { entries: [] } }, t: key => key,
		loadDraft: () => new Promise(resolve => { resolveDraft = resolve }), saveDraft: async () => {}, subscribeServerEvents: async () => {},
	}
	const result = runTui({ client, stdin, stdout })
	try {
		stdin.emit('data', 'new input')
		await tick()
		stdout.writes.length = 0
		resolveDraft('old draft')
		await tick()
		assert(!stdout.writes.join('').includes('old draft'))
	} finally { stdin.emit('data', '\x03'); stdin.emit('data', '\x04'); await result }
})

Deno.test('terminal cached layouts preserve control offsets, update previews and survive narrow nested headings', () => {
	const render = createTranscriptRenderer()
	const first = { id: 'user', role: 'user', content: 'hello' }
	const second = { id: 'a', content: '<details><summary>one</summary><details><summary>two</summary>\n# title\n</details></details>' }
	const options = { width: 8, expanded: new Set(['a:details:0', 'a:details:1']) }
	const entries = [first, second]
	assert.deepEqual(render(entries, options), { ...transcriptView(entries, options), styles: transcriptView(entries, options).lines.map((_, index) => transcriptView(entries, options).styles[index] || '') })
	assert(render([first, { ...second, content: 'changed' }], options).lines.join('\n').includes('change'))
	assert.equal(render([], options).lines.length, 0)
})
