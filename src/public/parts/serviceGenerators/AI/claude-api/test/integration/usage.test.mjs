/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { createPromptStructConversation } from 'fount/scripts/test/fixtures/ai_conversation.mjs'

import { GetSource } from '../../main.mjs'

Deno.test('Anthropic source retains final usage and adds independent tool rounds', async () => {
	const source = await GetSource({ model: 'claude-test', use_stream: true, convert_config: { assistantPrefill: false } }, {
		/**
		 * 提供测试响应。
		 * @returns {any} 测试返回值。
		 */
		getClient: () => ({ messages: {
			/**
			 * 提供测试响应。
			 * @returns {any} 测试返回值。
			 */
			create: async () => (async function* () {
				yield { type: 'message_start', message: { model: 'claude-test', usage: { input_tokens: 12, cache_read_input_tokens: 100, cache_creation_input_tokens: 50, output_tokens: 1 } } }
				yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } }
				yield { type: 'message_delta', usage: { output_tokens: 8 } }
			})(),
		} }),
	})
	const conversation = createPromptStructConversation({ charName: 'ZL-31', userName: 'Tester' })
	const result = {}
	for (let round = 0; round < 2; round++) await source.StructCall(conversation.makePromptStruct(), {
		base_result: result,
		/** 忽略预览。 */
		replyPreviewUpdater: () => {},
	})
	assertEquals(result.content, 'hello')
	assertEquals(result.extension.usage.calls.length, 2)
	assertEquals(result.extension.usage.total.inputTokens, 324)
	assertEquals(result.extension.usage.total.outputTokens, 16)
	assertEquals(result.extension.usage.total.costs, undefined)
})
