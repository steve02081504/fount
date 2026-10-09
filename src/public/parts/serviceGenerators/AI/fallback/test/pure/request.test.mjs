/* global Deno */
import { assertEquals, assertRejects } from 'jsr:@std/assert'

import { createFetchChatCompletionWithRetry } from '../../../proxy/src/chatCompletion.mjs'
import { AIOutputDegenerationError } from '../../../proxy/src/outputGuard.mjs'
import { mockJsonFetch, openaiMessageResponse } from '../../../proxy/test/mockFetch.mjs'
import { callWithFallback } from '../../request.mjs'

/** @returns {void} Do not persist mock configuration. */
function saveConfig() { }

Deno.test('source fallback cannot extend the two-attempt repetition recovery budget', async () => {
	const mock = mockJsonFetch(() => openaiMessageResponse('泥水'.repeat(150)))
	const call = createFetchChatCompletionWithRetry({ url: 'https://example.com/v1/chat/completions', model: 'mock', use_stream: false }, { SaveConfig: saveConfig })
	let laterCalls = 0
	try {
		await assertRejects(() => callWithFallback([
			{
				/** @returns {Promise<object>} Invoke a repeating source with its own repair policy. */
				Call: () => call([{ role: 'user', content: 'test' }]),
			},
			{
				/** @returns {object} Record an unexpected fallback invocation. */
				Call: () => { laterCalls++; return { content: 'should not run' } },
			},
		], source => source.Call()), AIOutputDegenerationError)
		assertEquals(mock.calls.length, 2)
		assertEquals(laterCalls, 0)
	} finally { mock.restore() }
})

Deno.test('ordinary source failures still fall back and cancelled requests do not', async () => {
	const originalError = console.error
	/**
	 * @returns {void} Silence the expected ordinary source failure.
	 */
	console.error = () => { }
	try {
		assertEquals(await callWithFallback([0, 1], async source => { if (!source) throw new Error('unavailable'); return { content: 'ok' } }), { content: 'ok' })
		const controller = new AbortController()
		controller.abort()
		let calls = 0
		const error = await assertRejects(() => callWithFallback([0, 1], async () => { calls++; return {} }, { signal: controller.signal }))
		assertEquals(error.name, 'AbortError')
		assertEquals(calls, 0)
	} finally { console.error = originalError }
})
