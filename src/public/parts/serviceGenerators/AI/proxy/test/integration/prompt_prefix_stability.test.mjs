/**
 * proxy + OpenAI mock：同一场对话的 prompt 前缀稳定性（纯追加）。
 *
 * `system_prompt_at_depth: 0` 让系统提示固定在开头（不随对话长度移位），
 * 此后 messages 只追加，故每轮请求应完整包含上一轮，缓存命中前缀始终稳定。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { createPromptStructConversation } from 'fount/scripts/test/fixtures/ai_conversation.mjs'
import { startOpenAIPromptCacheMock } from 'fount/scripts/test/fixtures/openai_prompt_cache_mock.mjs'

import generator from '../../main.mjs'

/** 会话轮数。 */
const ROUNDS = 100

Deno.test(`proxy ${ROUNDS} rounds keep an append-only prompt prefix`, async () => {
	const mock = await startOpenAIPromptCacheMock()
	try {
		const source = await generator.interfaces.serviceGenerator.GetSource({
			name: 'proxy-prefix-mock',
			url: mock.completionsUrl,
			model: 'mock-cache',
			apikey: 'test-key',
			context_size: 128000,
			system_prompt_at_depth: 0,
			use_stream: false,
			model_arguments: { temperature: 0, n: 1, logprobs: false },
			convert_config: {
				roleReminding: false,
				// 前置稳定测试只关心可重放的历史前缀；末尾的 assistant 预填充是每轮瞬时尾块，刻意排除。
				assistantPrefill: false,
				ignoreFiles: ['.*'],
				forceRoleAlternation: false,
				forceUserMessageEnding: false,
				forceNoSystemMessages: false,
			},
		}, {
			/**
			 * @returns {void}
			 */
			SaveConfig: () => { },
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
