/**
 * Codex Responses 多轮生成：完整历史重发且 assistant 回传为 output_text 内容块。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { createPromptStructConversation } from 'fount/scripts/test/fixtures/ai_conversation.mjs'

import { mockJsonFetch, strictResponsesHandler } from '../../../proxy/test/mockFetch.mjs'
import generator from '../../main.mjs'

Deno.test('Codex Responses replays the growing history in output-compatible shape', async () => {
	const mock = mockJsonFetch(strictResponsesHandler('codex-answer'))
	try {
		const source = await generator.interfaces.serviceGenerator.GetSource({
			name: 'codex-multiturn',
			model: 'gpt-5.1-codex',
			use_stream: false,
			convert_config: {
				roleReminding: false,
				ignoreFiles: [],
				forbidSystemFiles: [],
				forbidAssistantFiles: [],
				forceRoleAlternation: false,
				forceUserMessageEnding: false,
				forceNoSystemMessages: false,
			},
			oauth: {
				access: 'tok',
				refresh: 'r',
				expires: Date.now() + 60_000,
				accountId: 'acct_x',
			},
		}, {
			/** GetSource 依赖桩：空 SaveConfig。 */
			SaveConfig: async () => { },
		})
		const conversation = createPromptStructConversation({ charName: 'ZL-31', userName: 'Tester' })

		conversation.addUser('first question')
		const first = await source.StructCall(conversation.makePromptStruct(), {})
		assertEquals(first.content, 'codex-answer')
		conversation.addChar(first.content)

		conversation.addUser('second question')
		const second = await source.StructCall(conversation.makePromptStruct(), {})
		assertEquals(second.content, 'codex-answer')

		assertEquals(mock.calls.length, 2)
		const body = JSON.parse(mock.calls[1].init.body)
		assertEquals(body.store, false)
		assertEquals(typeof body.instructions, 'string')
		assertEquals(body.input.map(item => item.role), ['user', 'assistant', 'user'])
		const assistant = body.input[1]
		assertEquals(assistant.type, 'message')
		assertEquals(Array.isArray(assistant.content), true)
		assertEquals(assistant.content[0].type, 'output_text')
		assert(assistant.content[0].text.includes(first.content))
	}
	finally {
		mock.restore()
	}
})
