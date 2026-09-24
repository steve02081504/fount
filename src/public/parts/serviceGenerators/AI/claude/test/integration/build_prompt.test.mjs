/**
 * claude（cookie/web）`BuildPrompt`：出站 `{ prompt, chat_log }` 形态（system 置顶）与消息包装。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { createPromptStructConversation } from 'fount/scripts/test/fixtures/ai_conversation.mjs'

import generator from '../../main.mjs'

Deno.test('claude BuildPrompt returns { prompt, chat_log } mirroring outbound', async () => {
	const source = await generator.interfaces.serviceGenerator.GetSource(
		{ name: 'claude-build-prompt', model: 'claude-3-sonnet', cookie_array: [] },
		{
			/**
			 * 忽略配置持久化的桩函数。
			 * @returns {void}
			 */
			SaveConfig: () => { },
		},
	)
	const conversation = createPromptStructConversation({ charName: 'ZL-31', userName: 'Tester' })
	conversation.addUser('你好', 'user-1')
	conversation.addChar('你好呀', 'char-1')

	const out = await source.BuildPrompt(conversation.makePromptStruct())

	assert(Array.isArray(out.chat_log), 'chat_log array expected')
	assertEquals(out.chat_log.map(message => message.role), ['system', 'user', 'assistant'])
	assert(typeof out.prompt === 'string')
	assert(out.prompt.endsWith('\n\nAssistant:'), 'prompt must end with Assistant:')
	assert(out.prompt.includes('user: <message'), 'prompt must contain wrapped user message')
	assert(out.prompt.includes('<sender>Tester</sender>'), 'prompt must carry sender name')
})
