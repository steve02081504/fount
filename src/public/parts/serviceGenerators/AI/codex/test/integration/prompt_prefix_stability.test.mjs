/**
 * codex + Responses mock：同一场对话的 prompt 前缀稳定性（纯追加）。
 *
 * Responses 请求把系统提示放进 `instructions`、对话放进 `input`；
 * `system_prompt_at_depth: 0` 让两段都只随对话增长，缓存命中前缀始终稳定。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { createPromptStructConversation } from 'fount/scripts/test/fixtures/ai_conversation.mjs'
import { createPrefixCacheTracker } from 'fount/scripts/test/fixtures/prompt_cache_tracker.mjs'

import { mockJsonFetch, responsesOutputResponse } from '../../../proxy/test/mockFetch.mjs'
import generator from '../../main.mjs'

/** 会话轮数。 */
const ROUNDS = 40

/**
 * 把 Responses 请求体序列化为稳定字符串（用于前缀比较）。
 * @param {object} body Responses 请求体
 * @returns {string} 序列化结果
 */
function serializeResponsesBody(body) {
	const instructions = body.instructions ?? ''
	const input = (body.input || []).map(item => {
		const content = typeof item.content === 'string' ? item.content : JSON.stringify(item.content)
		return `${item.role ?? ''}\0${content}`
	}).join('\n')
	return `${instructions}\n${input}`
}

Deno.test(`codex ${ROUNDS} rounds keep an append-only prompt prefix`, async () => {
	const tracker = createPrefixCacheTracker()
	let callIndex = 0
	const mock = mockJsonFetch(request => {
		const body = JSON.parse(request.init.body)
		tracker.record(serializeResponsesBody(body))
		return responsesOutputResponse(`mock-ok:${callIndex++}`)
	})
	try {
		const source = await generator.interfaces.serviceGenerator.GetSource({
			name: 'codex-prefix-mock',
			model: 'gpt-5.1-codex',
			use_stream: false,
			system_prompt_at_depth: 0,
			convert_config: {
				roleReminding: false,
				// 前置稳定测试只关心可重放的历史前缀；末尾的 assistant 预填充是每轮瞬时尾块，刻意排除。
				assistantPrefill: false,
				ignoreFiles: ['.*'],
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

		for (let round = 0; round < ROUNDS; round++) {
			conversation.addUser(`第 ${round + 1} 轮：请确认。`)
			const result = await source.StructCall(conversation.makePromptStruct(), {})
			assert(typeof result.content === 'string', `round ${round} non-string content`)
			assert(result.content.includes('mock-ok:'), `round ${round} unexpected reply: ${result.content}`)
			conversation.addChar(result.content)
		}

		const summary = tracker.stats()
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
		mock.restore()
	}
})
