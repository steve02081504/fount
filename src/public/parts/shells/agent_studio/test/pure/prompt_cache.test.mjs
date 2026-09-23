/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { commonPrefixLength, estimateGenerationCache, estimatePromptCache, serializeRequest } from '../../public/shared/promptCache.mjs'

Deno.test('estimates contiguous prompt reuse across generations without claiming usage for expired snapshots', () => {
	const rates = estimatePromptCache([
		{ requests: [{ systemPrompt: 'instruction', messages: [{ role: 'user', content: 'hello' }] }] },
		{ requests: [{ systemPrompt: 'instruction', messages: [{ role: 'user', content: 'hello world' }] }] },
		{ requestCount: 1, requestsStripped: true },
	])
	assertEquals(rates[0].rate, null)
	assertEquals(rates[1].rate > 0.6, true)
	assertEquals(rates[2].rate, null)
})

Deno.test('estimateGenerationCache compares the first request against the supplied previous prompt', () => {
	const request = { systemPrompt: 'instruction', messages: [{ role: 'user', content: 'hello world' }] }
	const previous = serializeRequest({ systemPrompt: 'instruction', messages: [{ role: 'user', content: 'hello' }] })
	const metric = estimateGenerationCache(previous, [request])
	assertEquals(metric.rate > 0.6, true)
	assertEquals(estimateGenerationCache(null, [request]).rate, null)
	assertEquals(estimateGenerationCache(previous, []).rate, null)
})

Deno.test('serializeRequest and commonPrefixLength expose the character-level basis', () => {
	const serialized = serializeRequest({ systemPrompt: 'sys', messages: [{ role: 'user', content: 'hi' }] })
	assertEquals(serialized, 'sys\nuser\nhi')
	assertEquals(commonPrefixLength('abcd', 'abef'), 2)
	assertEquals(commonPrefixLength('', 'ab'), 0)
})
