/**
 * grok `BuildPrompt`：信封消息数组形态与缩进保真。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { createPromptStructConversation } from 'fount/scripts/test/fixtures/ai_conversation.mjs'

import generator from '../../main.mjs'

Deno.test('grok BuildPrompt returns envelope messages array', async () => {
	const source = await generator.interfaces.serviceGenerator.GetSource({
		name: 'grok-build-prompt',
		model: 'grok-3',
	})
	const conversation = createPromptStructConversation({ charName: 'ZL-31', userName: 'Tester' })
	conversation.addUser('你好', 'user-1')

	const out = await source.BuildPrompt(conversation.makePromptStruct())

	assertEquals(Array.isArray(out), true, 'BuildPrompt must return a bare messages array')
	const chat = out.find(message => typeof message.content === 'string' && message.content.includes('<message'))
	assert(chat, 'expected an envelope chat message')
	assert(chat.content.startsWith('\t\t <message'), 'grok envelope indent must be preserved')
	assert(chat.content.includes('<sender>Tester</sender>'), 'expected sender envelope')
	assert(out.some(message => message.role === 'system'), 'expected a system message')
})
