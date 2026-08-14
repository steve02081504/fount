/**
 * Workers AI：账号 completions URL 与 session affinity。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { mockJsonFetch, openaiMessageResponse } from '../../../proxy/test/mockFetch.mjs'
import generator from '../../main.mjs'

Deno.test('Workers AI Call sets session affinity and account URL', async () => {
	const mock = mockJsonFetch(() => openaiMessageResponse('cf'))
	try {
		const source = await generator.interfaces.serviceGenerator.GetSource({
			name: 'cf-workers',
			model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
			account_id: 'acct',
			apikey: 'tok',
			sessionAffinity: 'sess-1',
			use_stream: false,
		}, { /**
		 *
		 */
			SaveConfig: async () => { } })
		const result = await source.Call('hi')
		assertEquals(result.content, 'cf')
		assertEquals(
			mock.calls[0].url,
			'https://api.cloudflare.com/client/v4/accounts/acct/ai/v1/chat/completions',
		)
		assertEquals(mock.calls[0].init.headers['x-session-affinity'], 'sess-1')
		assertEquals(mock.calls[0].init.headers.Authorization, 'Bearer tok')
	}
	finally {
		mock.restore()
	}
})
