/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { estimatePromptCache } from '../../public/shared/promptCache.mjs'

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
