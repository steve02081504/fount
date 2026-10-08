/* global Deno */
/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-param-type, jsdoc/require-param-description, jsdoc/require-returns */
import { EventEmitter } from 'node:events'

import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert'

import { parseCodeArgs, resolveCodeOutputFormat, shouldUseCodeCli } from '../../cli/args.mjs'
import { createCodeClient } from '../../cli/client.mjs'
import { collectFileEdits, formatEntry, formatFileEdits, formatUsage, PrintCollector } from '../../cli/transcript.mjs'

Deno.test('code CLI argument parsing preserves inline and positional Unicode values', () => {
	assertEquals(parseCodeArgs(['--cli', '--workspace=项目', '-p', '第一行\n第二行', '--model', 'char']), {
		cli: true, print: false, help: false, attach: false, tuiMode: 'fullscreen',
		workspace: '项目', prompt: '第一行\n第二行', model: 'char',
	})
	assertThrows(() => parseCodeArgs(['--cli', '--session', '../wrong']))
	assertThrows(() => parseCodeArgs(['--attach', '--session', 'abc', '--prompt', 'x']))
	assertThrows(() => parseCodeArgs(['--cli', '--workspace', '.', '--workspace-id', 'one']))
	assertEquals(parseCodeArgs(['--output-format=ndjson']).outputFormat, 'ndjson')
	assertThrows(() => parseCodeArgs(['--output-format', 'yaml']))
	assertEquals(shouldUseCodeCli([]), false)
	assertEquals(shouldUseCodeCli(['--prompt', 'hello']), false)
	assertEquals(shouldUseCodeCli(['--cli']), true)
	assertEquals(shouldUseCodeCli(['--print']), true)
	assertEquals(shouldUseCodeCli(['--output-format=text']), true)
	assertEquals(resolveCodeOutputFormat(undefined, false), 'ndjson')
	assertEquals(resolveCodeOutputFormat(undefined, undefined), 'ndjson')
	assertEquals(resolveCodeOutputFormat(undefined, true), 'text')
	assertEquals(resolveCodeOutputFormat('text', false), 'text')
})

Deno.test('print transcript uses committed display text and skips user/placeholder', async () => {
	assertEquals(formatEntry({ role: 'user', content: 'prompt' }), '')
	assertEquals(formatEntry({ role: 'user', content: 'prompt' }, { includeUser: true }), '## user\nprompt\n')
	assertEquals(formatEntry({ role: 'char', is_generating: true, content: 'preview' }), '')
	assertEquals(formatEntry({ role: 'tool', name: 'run-js', content: 'internal', content_for_show: 'shown',
		extension: { toolCall: { summary: 'Inspect file' } } }), '## run-js: Inspect file\nshown\n')
	const collector = new PrintCollector({ threshold: 1 })
	try {
		await collector.add({ id: 'a', role: 'char', name: 'coder', content: 'first' })
		await collector.add({ id: 'a', role: 'char', name: 'coder', content: 'duplicate' })
		await collector.add({ id: 'b', role: 'system', content: 'notice' })
		await collector.add({ id: 'c', role: 'char', is_generating: true, content: 'placeholder' })
		let output = ''
		await collector.write({
			write: value => { output += value; return true } })
		assertEquals(output, '## coder\nfirst\n\n## System\nnotice\n\n')
	}
	finally { await collector.cleanup() }
})

Deno.test('usage labels take code.usage copy and fall back to plain English', () => {
	const usage = { calls: [{ inputTokens: 12, outputTokens: 3 }], total: { inputTokens: 12, outputTokens: 3, costs: { USD: 0.0025 } } }
	const localized = {
		'code.usage.inputTokens': '进 ${count}', 'code.usage.outputTokens': '出 ${count}',
		'code.usage.estimatedCost': '费 ${amount} ${currency}',
	}
	const translate = (key, params) => localized[key]?.replace(/\$\{(\w+)\}/g, (_, name) => params[name])
	assertEquals(formatUsage(usage, translate), '进 12 · 出 3 · 费 0.0025 USD')
	// 缺译文（返回键名 / 非字符串）与未知费用都回落到英文并跳过
	assertEquals(formatUsage(usage), '12 input · 3 output · known cost USD 0.0025')
	assertEquals(formatUsage(usage, key => key), '12 input · 3 output · known cost USD 0.0025')
	assertEquals(formatUsage({ calls: [], total: { inputTokens: 12, costs: { USD: 1 } } }), '12 input · known cost USD 1')
	assertEquals(formatUsage({ calls: [], total: { costs: { USD: Number.NaN } } }), '')
	assertEquals(formatUsage(undefined), '')
})

Deno.test('NDJSON writes appended entries unchanged, including user entries, once', async () => {
	const collector = new PrintCollector({ outputFormat: 'ndjson' })
	const entry = { id: 'user-1', role: 'user', uid: 'user', content: 'hello', extension: { usage: { total: { inputTokens: 1 } } } }
	let output = ''
	const stdout = { destroyed: false, write: value => { output += value; return true } }
	await collector.add(entry, stdout)
	await collector.add(entry, stdout)
	await collector.add({ id: 'placeholder', is_generating: true }, stdout)
	await collector.write(stdout)
	assertEquals(output, JSON.stringify(entry) + '\n')
})

Deno.test('CLI NDJSON emits authoritative entries before terminal and ignores terminal replay', async () => {
	const entries = [
		{ id: 'user-1', role: 'user', uid: 'user', content: 'hello' },
		{ id: 'reply-1', role: 'char', uid: 'char', content: 'hi', extension: { usage: { calls: [], total: { outputTokens: 1 } } } },
	]
	const session = { id: 'session-1', charname: 'coder', profile: 'build', entries: [], version: 1 }
	let output = ''
	const stdout = { destroyed: false, write: value => { output += value; return true } }
	const collector = new PrintCollector({ outputFormat: 'ndjson' })
	const client = createCodeClient({
		workspaceId: 'workspace-1', sessionId: session.id, char: 'coder', profile: 'build',
		transport: {
			get: async path => path.endsWith('/workspaces') ? { list: [{ id: 'workspace-1', machine: '0', path: 'C:/repo' }] }
				: path.includes('/sessions/') ? session : [],
			put: async () => ({}),
			stream: async (_path, _payload, { onFrame }) => {
				onFrame({ type: 'entries-append', entries })
				assertEquals(output, entries.map(entry => JSON.stringify(entry) + '\n').join(''))
				onFrame({ type: 'done', entries })
				return { type: 'done', entries }
			},
		},
	})
	try {
		await client.selectWorkspace('workspace-1')
		await client.openSession(session.id)
		await client.run({ input: 'hello', collectEntries: false, onEvent: event => {
			if (event.type === 'entry') void collector.add(event.entry, stdout)
		} })
		await collector.write(stdout)
		assertEquals(output, entries.map(entry => JSON.stringify(entry) + '\n').join(''))
	} finally { await collector.cleanup() }
})

Deno.test('file-edit summary accumulates per path and prints the requested diff', () => {
	const edit = (path, added, removed, diff) => ({ role: 'tool', extension: { pluginData: { 'file-operations': { edit: { path, added, removed, diff } } } } })
	const entries = [
		edit('src/a.mjs', 2, 1, '-old\n+new'),
		edit('src/b.mjs', 1, 0, '+b'),
		edit('src/a.mjs', 3, 4, '-x'),
		{ role: 'char', content: 'no edit here' },
	]
	assertEquals(collectFileEdits(entries).map(item => [item.path, item.added, item.removed]), [['src/a.mjs', 5, 5], ['src/b.mjs', 1, 0]])
	assertEquals(formatFileEdits(entries), 'src/a.mjs  +5 -5\nsrc/b.mjs  +1 -0')
	assertEquals(formatFileEdits(entries, 'b.mjs'), 'src/b.mjs  +1 -0\n\n+b')
	assertEquals(formatFileEdits(entries, 'missing.mjs'), 'no recorded edit for missing.mjs')
	assertEquals(formatFileEdits([{ role: 'char', content: 'none' }]), 'no recorded file edits in this session')
})

Deno.test('print collector stops waiting when a backpressured stdout closes', async () => {
	const collector = new PrintCollector()
	await collector.add({ id: 'a', role: 'char', content: 'answer' })
	const stream = new EventEmitter()
	stream.write = () => { queueMicrotask(() => stream.emit('close')); return false }
	await assertRejects(() => collector.write(stream), Error, 'stdout closed')
})
