/**
 * freeuse `BuildPrompt`：出站 `{ prompt }` 字符串形态（system + 聊天记录 + 续写引导）。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { createPromptStructConversation } from 'fount/scripts/test/fixtures/ai_conversation.mjs'

import generator from '../../main.mjs'

Deno.test('freeuse BuildPrompt returns { prompt } with system, chat log and char lead-in', async () => {
	const source = await generator.interfaces.serviceGenerator.GetSource({ name: 'freeuse-build-prompt' })
	const conversation = createPromptStructConversation({ charName: 'ZL-31', userName: 'Tester' })
	conversation.addUser('你好', 'user-1')

	const out = await source.BuildPrompt(conversation.makePromptStruct())

	assertEquals(typeof out.prompt, 'string')
	assert(out.prompt.includes('Character settings:'), 'system prompt expected')
	assert(out.prompt.includes('Tester: 你好\n<|endofres|>'), 'chat log entry with end token expected')
	assert(out.prompt.endsWith('ZL-31: '), 'char lead-in expected')
})
