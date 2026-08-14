/**
 * AI Gateway：openai 前缀走 OpenAI 通道与 cf-aig-authorization。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { mockJsonFetch, openaiMessageResponse } from '../../../proxy/test/mockFetch.mjs'
import generator from '../../main.mjs'

/**
 *
 */
const saveConfig = async () => { }

Deno.test('AI Gateway openai prefix uses cf-aig-authorization', async () => {
	const mock = mockJsonFetch(() => openaiMessageResponse('gw'))
	try {
		const source = await generator.interfaces.serviceGenerator.GetSource({
			name: 'cf-gw',
			model: 'openai/gpt-4.1',
			account_id: 'acct',
			gateway_id: 'gw1',
			apikey: 'tok',
			use_stream: false,
		}, { SaveConfig: saveConfig })
		const result = await source.Call('hi')
		assertEquals(result.content, 'gw')
		assertEquals(
			mock.calls[0].url,
			'https://gateway.ai.cloudflare.com/v1/acct/gw1/openai/chat/completions',
		)
		assertEquals(mock.calls[0].init.headers['cf-aig-authorization'], 'Bearer tok')
		const body = JSON.parse(mock.calls[0].init.body)
		assertEquals(body.model, 'gpt-4.1')
	}
	finally {
		mock.restore()
	}
})
