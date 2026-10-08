/* global Deno */
/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-param-type, jsdoc/require-param-description, jsdoc/require-returns */
import { assertEquals, assertRejects } from 'jsr:@std/assert'

import { executeCommand } from '../../cli/commands.mjs'

Deno.test('CLI edit clears display overlays and saves against the refreshed version', async () => {
	const entry = { id: 'm1', role: 'char', content: 'old', content_for_show: 'shown', content_for_edit: 'editable' }
	const session = { id: 'one', version: 3, entries: [entry] }
	let saved
	const client = {
		state: { sessionId: 'one', session, attachments: [] },
		target: () => ({ machine: '0', workdir: '/repo' }),
		refreshSession: async () => session,
		transport: { put: async (path, body) => { saved = { path, body }; return { version: 4 } } },
	}
	await executeCommand('/edit m1 replacement', { client })
	assertEquals(entry.content, 'replacement')
	assertEquals('content_for_show' in entry, false)
	assertEquals('content_for_edit' in entry, false)
	assertEquals(saved.path.endsWith('/sessions/one'), true)
	assertEquals(saved.body.expectedVersion, 3)
	assertEquals(session.version, 4)
	await assertRejects(() => executeCommand('/feedback m1 sideways', { client }), Error, 'feedback must be up or down')
})

Deno.test('CLI attachment reads workspace binary payload and sends that exact file', async () => {
	const calls = []
	const file = { name: 'picture.png', mime_type: 'image/png', buffer: 'AAEC' }
	const state = { sessionId: 'one', workspaceId: 'ws', attachments: [] }
	const client = {
		state,
		target: () => ({ machine: '7', workdir: '/remote/repo' }),
		transport: { get: async path => { calls.push(path); return file } },
		run: async options => { calls.push(options); return { status: 'done' } },
	}
	assertEquals(await executeCommand('/attach-file "images/picture.png"', { client }), { text: 'attached picture.png' })
	assertEquals(calls[0].includes('/workspace/attachment?'), true)
	assertEquals(new URL(`https://local${calls[0]}`).searchParams.get('machine'), '7')
	assertEquals(new URL(`https://local${calls[0]}`).searchParams.get('path'), 'images/picture.png')
	await executeCommand('/send describe it', { client })
	assertEquals(calls[1].files, [file])
	assertEquals(state.attachments, [])
})

Deno.test('CLI text export includes both user and assistant entries', async () => {
	const client = { state: { sessionId: 'one', session: { entries: [
		{ id: 'u', role: 'user', content: 'Question' },
		{ id: 'a', role: 'char', name: 'coder', content: 'Answer' },
	] } } }
	const result = await executeCommand('/export', { client })
	assertEquals(result.text.includes('Question'), true)
	assertEquals(result.text.includes('Answer'), true)
})
