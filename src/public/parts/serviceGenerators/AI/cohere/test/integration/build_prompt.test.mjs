/**
 * cohere `BuildPrompt`：出站 `{ model, messages }` 形态（system 置顶 + 聊天记录）。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { createPromptStructConversation } from 'fount/scripts/test/fixtures/ai_conversation.mjs'

import generator from '../../main.mjs'

Deno.test('cohere BuildPrompt returns { model, messages } with system first', async () => {
	const source = await generator.interfaces.serviceGenerator.GetSource({
		name: 'cohere-build-prompt',
		model: 'command-r-plus',
		apikey: 'test-key',
	})
	const conversation = createPromptStructConversation({ charName: 'ZL-31', userName: 'Tester' })
	conversation.addUser('你好', 'user-1')
	conversation.addChar('你好呀', 'char-1')

	const out = await source.BuildPrompt(conversation.makePromptStruct())

	assertEquals(out.model, 'command-r-plus')
	assert(Array.isArray(out.messages), 'messages array expected')
	assertEquals(out.messages.map(message => message.role), ['system', 'user', 'assistant'])
	assert(out.messages[0].content.includes('Character settings:'), 'system prompt expected')
	assert(out.messages[1].content.includes('<sender>Tester</sender>'), 'message wrapper expected')
})
