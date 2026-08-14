/**
 * GitHub Copilot：换票后的 completions URL 与 Copilot 头。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { mockJsonFetch, openaiMessageResponse } from '../../../proxy/test/mockFetch.mjs'
import generator from '../../main.mjs'

/**
 *
 */
const saveConfig = async () => { }

Deno.test('Copilot Call uses copilot host and editor headers', async () => {
	const mock = mockJsonFetch(() => openaiMessageResponse('ok'))
	try {
		const source = await generator.interfaces.serviceGenerator.GetSource({
			name: 'copilot',
			model: 'gpt-4.1',
			use_stream: false,
			oauth: {
				access: 'tid=1;proxy-ep=proxy.individual.githubcopilot.com',
				refresh: 'gh',
				expires: Date.now() + 60_000,
			},
		}, { SaveConfig: saveConfig })
		const result = await source.Call('hi')
		assertEquals(result.content, 'ok')
		assertEquals(mock.calls[0].url, 'https://api.individual.githubcopilot.com/chat/completions')
		const headers = mock.calls[0].init.headers
		assertEquals(headers.Authorization, 'Bearer tid=1;proxy-ep=proxy.individual.githubcopilot.com')
		assertEquals(headers['Copilot-Integration-Id'], 'vscode-chat')
		assertEquals(headers['Editor-Version'], 'vscode/1.107.0')
	}
	finally {
		mock.restore()
	}
})
