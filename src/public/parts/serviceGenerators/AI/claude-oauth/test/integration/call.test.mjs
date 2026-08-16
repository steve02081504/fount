/**
 * Claude OAuth：Bearer + oauth-2025-04-20，无 billing spoof 头。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { mockJsonFetch } from '../../../proxy/test/mockFetch.mjs'
import generator from '../../main.mjs'

Deno.test('Claude OAuth Call sends auth token beta header without billing spoof', async () => {
	const mock = mockJsonFetch(() => new Response(JSON.stringify({
		content: [{ type: 'text', text: 'hi' }],
	}), { status: 200, headers: { 'Content-Type': 'application/json' } }))
	try {
		const source = await generator.interfaces.serviceGenerator.GetSource({
			name: 'claude-oauth',
			model: 'claude-sonnet-4-5',
			use_stream: false,
			oauth: {
				access: 'oauth-token',
				refresh: 'r',
				expires: Date.now() + 60_000,
			},
		}, {
			/** GetSource 依赖桩：空 SaveConfig。 */
			SaveConfig: async () => { }
		})
		const result = await source.Call('hello')
		assertEquals(result.content, 'hi')
		const headers = new Headers(mock.calls[0].init.headers)
		assertEquals((headers.get('authorization') || headers.get('Authorization'))?.includes('oauth-token'), true)
		assertEquals(String(headers.get('anthropic-beta')).includes('oauth-2025-04-20'), true)
		assertEquals(headers.get('x-anthropic-billing-header'), null)
	}
	finally {
		mock.restore()
	}
})
