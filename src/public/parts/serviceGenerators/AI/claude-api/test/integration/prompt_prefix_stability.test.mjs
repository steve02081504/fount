/**
 * claude-api + Anthropic mock：同一场对话的 prompt 前缀稳定性（纯追加）。
 *
 * Claude 把系统提示放在 `system` 字段，`messages` 只随对话增长，
 * 因此每轮 `system + messages` 应完整包含上一轮。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { createPromptStructConversation } from 'fount/scripts/test/fixtures/ai_conversation.mjs'
import { startClaudePromptCacheMock } from 'fount/scripts/test/fixtures/claude_prompt_cache_mock.mjs'

import generator from '../../main.mjs'

/** 会话轮数。 */
const ROUNDS = 40

Deno.test(`claude-api ${ROUNDS} rounds keep an append-only prompt prefix`, async () => {
	const mock = await startClaudePromptCacheMock()
	try {
		const source = await generator.interfaces.serviceGenerator.GetSource({
			name: 'claude-prefix-mock',
			apikey: 'test-key',
			model: 'claude-3-5-sonnet-20240620',
			context_size: 200000,
			use_stream: false,
			base_url: mock.baseUrl,
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
