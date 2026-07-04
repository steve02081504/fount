/* global Deno */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { isPartInvokeResponse, normalizePartpath } from '../../part_invoke.mjs'

Deno.test('normalizePartpath accepts shells/foo paths', () => {
	assertEquals(normalizePartpath('shells/social'), 'shells/social')
	assertEquals(normalizePartpath('/shells/social/'), 'shells/social')
	assertEquals(normalizePartpath(''), null)
	assertEquals(normalizePartpath('shells:social'), null)
})

Deno.test('isPartInvokeResponse rejects empty and ambiguous shapes', () => {
	assertEquals(isPartInvokeResponse({}), false)
	assertEquals(isPartInvokeResponse({ result: 1, error: { message: 'x', code: 'X' } }), false)
	assertEquals(isPartInvokeResponse({ error: { message: 'fail' } }), false)
	assertEquals(isPartInvokeResponse({ error: { message: 'fail', code: 'FAIL' } }), true)
	assertEquals(isPartInvokeResponse({ result: { ok: true } }), true)
	assertEquals(isPartInvokeResponse(null), false)
})

Deno.test('part wire does not import shell parts', async () => {
	const url = new URL('../../part_wire.mjs', import.meta.url)
	const text = await readFile(fileURLToPath(url), 'utf8')
	assert(!text.includes('public/parts/shells/social'))
	assert(!text.includes('public/parts/shells/chat'))
	assert(text.includes('part_invoke.mjs'))
	assert(text.includes('handleIncomingPartInvokeRequest'))
	assert(text.includes('handleIncomingPartInvokeFireAndForget'))
})
