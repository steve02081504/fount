/**
 * Azure Responses：api-key 头与 /openai/v1/responses。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { mockJsonFetch, responsesOutputResponse } from '../../../proxy/test/mockFetch.mjs'
import generator from '../../main.mjs'

/**
 *
 */
const saveConfig = async () => { }

Deno.test('Azure Responses Call uses api-key header', async () => {
	const mock = mockJsonFetch(() => responsesOutputResponse('az'))
	try {
		const source = await generator.interfaces.serviceGenerator.GetSource({
			name: 'azure',
			model: 'gpt-4.1',
			apikey: 'azure-key',
			endpoint: 'https://demo.openai.azure.com',
			use_stream: false,
		}, { SaveConfig: saveConfig })
		const result = await source.Call('hi')
		assertEquals(result.content, 'az')
		assertEquals(mock.calls[0].url, 'https://demo.openai.azure.com/openai/v1/responses')
		assertEquals(mock.calls[0].init.headers['api-key'], 'azure-key')
	}
	finally {
		mock.restore()
	}
})
