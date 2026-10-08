/* global Deno */
/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-param-type, jsdoc/require-param-description, jsdoc/require-returns */
import { EventEmitter } from 'node:events'
import process from 'node:process'

import { assertEquals, assertRejects } from 'jsr:@std/assert'

import { createCodeClient } from '../../cli/client.mjs'
import { readStdin, Run } from '../../cli/main.mjs'

Deno.test('a delayed usage refresh does not replace a newly selected session', async () => {
	let finishRead
	const client = createCodeClient({ transport: { get: () => new Promise(resolve => { finishRead = resolve }) } })
	Object.assign(client.state, { sessionId: 'old', workspaceId: 'workspace', workspace: { machine: '0', path: '/work' } })
	const refresh = client.refreshSession()
	const selected = { id: 'new', entries: [] }
	Object.assign(client.state, { sessionId: 'new', session: selected })
	finishRead({ id: 'old', entries: [], usage: { total: { inputTokens: 12 } } })
	await refresh
	assertEquals(client.state.session, selected)
})

Deno.test('CLI sends scoped versioned run and gathers committed entries once', async () => {
	const frames = []
	const requests = []
	const stored = { id: 'one', entries: [], version: 4, charname: 'coder', profile: 'build', ai_source: '' }
	const transport = {
		get: async path => {
			if (path.endsWith('/workspaces')) return { list: [{ id: 'workspace', machine: '0', path: '/project' }] }
			if (path.includes('/sessions/one')) return stored
			throw new Error(path)
		},
		put: async () => ({}),
		stream: async (_path, payload, { onFrame }) => {
			requests.push(payload)
			assertEquals(client.state.session.entries.at(-1).content, 'question')
			onFrame({ type: 'entries-append', runId: payload.runId, sessionId: 'one', entries: [{ id: 'a', role: 'tool', content: 'ran' }] })
			onFrame({ type: 'preview', content: 'draft' })
			onFrame({ type: 'done', runId: payload.runId, sessionId: 'one', entries: [{ id: 'a', role: 'tool', content: 'ran' }, { id: 'b', role: 'char', content: 'answer' }] })
			return { type: 'done', runId: payload.runId }
		},
	}
	const client = createCodeClient({ transport, workspaceId: 'workspace', username: 'alice' })
	await client.selectWorkspace('workspace')
	await client.openSession('one')
	const result = await client.run({ input: 'question',
		onEvent: event => frames.push(event) })
	assertEquals(requests[0].expectedVersion, 4)
	assertEquals(requests[0].replace, false)
	assertEquals(requests[0].workdir, '/project')
	assertEquals(requests[0].session.entries.at(-1).content, 'question')
	assertEquals(result.entries.map(entry => entry.id), ['a', 'b'])
	assertEquals(frames.filter(event => event.type === 'entry').map(event => event.entry.id), ['a', 'b'])
})

Deno.test('CLI server-event subscription filters by session and maps bus events', async () => {
	const emitted = []
	let busHandler
	const transport = {
		events: async ({ onEvent }) => { busHandler = onEvent } }
	const client = createCodeClient({ transport, workspaceId: 'workspace', sessionId: 'one' })
	await client.subscribeServerEvents({
		onEvent: event => emitted.push(event) })
	busHandler('code-run-started', { chatName: 'code-other', runId: 'r0' })
	busHandler('code-run-started', { chatName: 'code-one', runId: 'r1' })
	busHandler('code-session-entry', { chatName: 'code-one', entry: { id: 'e1', role: 'system' } })
	busHandler('code-run-settled', { chatName: 'code-one', runId: 'r1', status: 'done' })
	busHandler('subagent-run', { chatName: 'code-one' })
	busHandler('code-session-entry', { chatName: 'code-two', entry: { id: 'e2' } })
	assertEquals(emitted, [
		{ type: 'run-started', runId: 'r1' },
		{ type: 'entry', entry: { id: 'e1', role: 'system' } },
		{ type: 'settled', runId: 'r1', status: 'done' },
	])
})

Deno.test('CLI reserves a session before async refresh so two local sends cannot race', async () => {
	let releaseRefresh
	const refreshGate = new Promise(resolve => { releaseRefresh = resolve })
	let reads = 0
	const transport = {
		get: async path => {
			if (path.endsWith('/workspaces')) return { list: [{ id: 'workspace', machine: '0', path: '/project' }] }
			if (path.includes('/sessions/one')) { if (++reads > 1) await refreshGate; return { id: 'one', entries: [], version: 1, charname: 'coder' } }
			throw new Error(path)
		},
		put: async () => ({}),
		stream: async (_path, payload) => ({ type: 'done', runId: payload.runId }),
	}
	const client = createCodeClient({ transport, workspaceId: 'workspace' })
	await client.selectWorkspace('workspace')
	await client.openSession('one')
	const first = client.run({ input: 'first' })
	await assertRejects(() => client.run({ input: 'second' }), Error, 'already running')
	releaseRefresh()
	await first
})

Deno.test('CLI draft requests write to the session the caller pinned, not the one now selected', async () => {
	const requests = []
	const transport = {
		put: async (path, body) => { requests.push({ path, body }); return { draft: body.draft } },
		get: async path => { requests.push({ path }); return { draft: 'pinned' } },
	}
	const client = createCodeClient({ transport, workspaceId: 'workspace', sessionId: 'two' })
	const saving = client.saveDraft('pending', { sessionId: 'one', workspaceId: 'workspace' })
	client.state.sessionId = 'other'
	await saving
	assertEquals(await client.loadDraft({ sessionId: 'one', workspaceId: 'workspace' }), 'pinned')
	assertEquals(requests, [
		{ path: '/api/parts/shells:code/cli-drafts/one', body: { workspaceId: 'workspace', draft: 'pending' } },
		{ path: '/api/parts/shells:code/cli-drafts/one?workspaceId=workspace' },
	])
	assertEquals(await client.loadDraft({ sessionId: 'one' }), 'pinned')
})

Deno.test('prompt-file stdin decoding survives a multibyte character split across chunks', async () => {
	async function* chunks() { yield new Uint8Array([0xe4, 0xbd]); yield new Uint8Array([0xa0, 0xe5, 0xa5, 0xbd]) }
	assertEquals(await readStdin(chunks()), '你好')
})

Deno.test('CLI reconnects by attaching to the exact run without resending the prompt', async () => {
	const requests = []
	const stored = { id: 'one', entries: [], version: 1, charname: 'coder' }
	const transport = {
		get: async path => path.endsWith('/workspaces') ? { list: [{ id: 'workspace', machine: '0', path: '/project' }] } : stored,
		put: async () => ({}),
		stream: async (_path, payload, { onFrame }) => {
			requests.push(payload)
			if (payload.type === 'send') {
				onFrame({ type: 'entries-append', entries: [{ id: 'tool', role: 'tool', content: 'first' }] })
				throw new Error('connection closed before run settled')
			}
			onFrame({ type: 'done', entries: [{ id: 'tool', role: 'tool', content: 'first' }, { id: 'reply', role: 'char', content: 'answer' }] })
			return { type: 'done' }
		},
	}
	const client = createCodeClient({ transport, workspaceId: 'workspace' })
	await client.selectWorkspace('workspace')
	await client.openSession('one')
	const result = await client.run({ input: 'send once' })
	assertEquals(requests.map(request => request.type), ['send', 'attach'])
	assertEquals(requests[1].runId, requests[0].runId)
	assertEquals(requests[1].workdir, '/project')
	assertEquals(result.entries.map(entry => entry.id), ['tool', 'reply'])
})

Deno.test('CLI does not attribute later persisted entries to a disconnected run', async () => {
	const stored = { id: 'one', entries: [], version: 1, charname: 'coder' }
	const transport = {
		get: async path => path.endsWith('/workspaces') ? { list: [{ id: 'workspace', machine: '0', path: '/project' }] } : stored,
		put: async () => ({}),
		stream: async (_path, payload, { onFrame }) => {
			if (payload.type === 'send') {
				onFrame({ type: 'entries-append', entries: [{ id: 'known', role: 'tool', content: 'committed before loss' }] })
				stored.entries = [{ id: 'later', role: 'char', content: 'another run' }]
				throw new Error('connection closed before run settled')
			}
			return { type: 'error', error: 'no active run' }
		},
	}
	const client = createCodeClient({ transport, workspaceId: 'workspace' })
	await client.selectWorkspace('workspace')
	await client.openSession('one')
	const result = await client.run({ input: 'question' })
	assertEquals(result.status, 'error')
	assertEquals(result.entries.map(entry => entry.id), ['known'])
})

Deno.test('direct print Run registers and releases its SIGINT listener through cleanup', async () => {
	const baseline = process.listenerCount('SIGINT')
	const stdout = new EventEmitter()
	stdout.write = () => true
	const stderr = { write: () => true }
	const cleanups = []
	const code = await Run({
		args: ['--print', '--prompt', 'hello'],
		data: { baseUrl: 'http://127.0.0.1:1', apiKey: 'test', workspaceId: 'missing' },
		stdin: { isTTY: false }, stdout, stderr, isTTY: false,
		onCleanup: callback => { cleanups.push(callback) },
	})
	assertEquals(code, 1)
	assertEquals(process.listenerCount('SIGINT'), baseline + 1)
	for (const cleanup of cleanups.reverse()) await cleanup()
	assertEquals(process.listenerCount('SIGINT'), baseline)
})
