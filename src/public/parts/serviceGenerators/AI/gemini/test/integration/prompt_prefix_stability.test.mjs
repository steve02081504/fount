/**
 * gemini + Gemini mock：同一场对话的 prompt 前缀稳定性（纯追加）。
 *
 * 关闭默认 prompt 与 system 注入深度（`system_prompt_at_depth: 0`）后，
 * 每轮请求的 `contents` 应完整包含上一轮，即缓存命中前缀始终稳定。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { createPromptStructConversation } from 'fount/scripts/test/fixtures/ai_conversation.mjs'
import { startGeminiPromptCacheMock } from 'fount/scripts/test/fixtures/gemini_prompt_cache_mock.mjs'

import generator from '../../main.mjs'

/** 会话轮数。 */
const ROUNDS = 40

Deno.test(`gemini ${ROUNDS} rounds keep an append-only prompt prefix`, async () => {
	const mock = await startGeminiPromptCacheMock()
	try {
		const source = await generator.interfaces.serviceGenerator.GetSource({
			name: 'gemini-prefix-mock',
			apikey: 'test-key',
			model: 'gemini-2.0-flash',
			max_input_tokens: 1048576,
			system_prompt_at_depth: 0,
			disable_default_prompt: true,
			use_stream: false,
			base_url: mock.baseUrl,
			model_arguments: {
				responseMimeType: 'text/plain',
				responseModalities: ['Text'],
			},
		})
		const conversation = createPromptStructConversation({ charName: 'ZL-31', userName: 'Tester' })

		for (let round = 0; round < ROUNDS; round++) {
			conversation.addUser(`第 ${round + 1} 轮：请确认。`)
			const result = await source.StructCall(conversation.makePromptStruct(), {})
			assert(typeof result.content === 'string', `round ${round} non-string content`)
			assert(result.content.includes('mock-ok:'), `round ${round} unexpected reply: ${result.content}`)
			conversation.addChar(result.content)
		}

		const summary = mock.stats()
		assertEquals(summary.requests, ROUNDS)
		assert(
			summary.allGrewOnly,
			`prompt prefix diverged: ${JSON.stringify(summary.perRequest.map(row => ({ grewOnly: row.grewOnly, divergeAt: row.divergeAt })).filter(row => !row.grewOnly)[0])}`,
		)
		assertEquals(
			summary.minCommonWithFirstTokens,
			summary.firstPromptTokens,
			'every round must start with the first round prompt',
		)
	}
	finally {
		await mock.close()
	}
})
