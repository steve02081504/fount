/**
 * duckduckgo `BuildPrompt`：信封消息数组形态。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { createPromptStructConversation } from 'fount/scripts/test/fixtures/ai_conversation.mjs'

import generator from '../../main.mjs'

Deno.test('duckduckgo BuildPrompt returns envelope messages array', async () => {
	const source = await generator.interfaces.serviceGenerator.GetSource({
		name: 'duckduckgo-build-prompt',
		model: 'gpt-4o-mini',
	})
	const conversation = createPromptStructConversation({ charName: 'ZL-31', userName: 'Tester' })
	conversation.addUser('你好', 'user-1')

	const out = await source.BuildPrompt(conversation.makePromptStruct())

	assertEquals(Array.isArray(out), true, 'BuildPrompt must return a bare messages array')
	const chat = out.find(message => typeof message.content === 'string' && message.content.includes('<message'))
	assert(chat, 'expected an envelope chat message')
	assert(chat.content.startsWith('<message'), 'duckduckgo envelope has no indent')
	assert(chat.content.includes('<sender>Tester</sender>'), 'expected sender envelope')
	assert(out.some(message => message.role === 'system'), 'expected a system message')
})
