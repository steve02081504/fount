/**
 * Codex Responses 请求头与 body。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { mockJsonFetch, responsesOutputResponse } from '../../../proxy/test/mockFetch.mjs'
import generator from '../../main.mjs'

/**
 *
 */
const saveConfig = async () => { }

Deno.test('Codex Call posts Responses with account id and originator fount', async () => {
	const mock = mockJsonFetch(() => responsesOutputResponse('pong'))
	try {
		const source = await generator.interfaces.serviceGenerator.GetSource({
			name: 'codex',
			model: 'gpt-5.1-codex',
			use_stream: false,
			oauth: {
				access: 'tok',
				refresh: 'r',
				expires: Date.now() + 60_000,
				accountId: 'acct_x',
			},
		}, { SaveConfig: saveConfig })
		const result = await source.Call('hi')
		assertEquals(result.content, 'pong')
		assertEquals(mock.calls[0].url, 'https://chatgpt.com/backend-api/codex/responses')
		const headers = mock.calls[0].init.headers
		assertEquals(headers.Authorization, 'Bearer tok')
		assertEquals(headers['ChatGPT-Account-Id'], 'acct_x')
		assertEquals(headers['OpenAI-Beta'], 'responses=v1')
		assertEquals(headers.originator, 'fount')
		const body = JSON.parse(mock.calls[0].init.body)
		assertEquals(body.store, false)
		assertEquals(body.input[0].content, 'hi')
	}
	finally {
		mock.restore()
	}
})
