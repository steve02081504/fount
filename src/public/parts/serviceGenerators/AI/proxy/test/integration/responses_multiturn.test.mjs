/**
 * Proxy 的 Responses API 多轮生成兼容性。
 *
 * Responses API 无状态：每轮都必须把完整历史随 `input` 重发，且回传的 assistant
 * 历史在严格后端上必须是 `output_text` 内容块（字符串 content 会 400）。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { createPromptStructConversation } from 'fount/scripts/test/fixtures/ai_conversation.mjs'

import generator from '../../main.mjs'
import { mockJsonFetch, strictResponsesHandler } from '../mockFetch.mjs'

/**
 * 构造禁用持久化的 proxy 源。
 * @param {object} config - 覆盖配置。
 * @param {() => void} [onSave] - 配置保存回调。
 * @returns {Promise<{config: object, source: object}>} 配置与 AI 源。
 */
async function makeSource(config, onSave = () => { }) {
	const sourceConfig = {
		name: 'proxy-responses-multiturn',
		url: 'https://example.com/v1/responses',
		model: 'mock-model',
		apikey: 'test-key',
		api_mode: 'responses',
		use_stream: false,
		model_arguments: { temperature: 0, n: 1, logprobs: false, top_logprobs: 5 },
		convert_config: {
			roleReminding: false,
			ignoreFiles: [],
			forbidSystemFiles: [],
			forbidAssistantFiles: [],
			forceRoleAlternation: false,
			forceUserMessageEnding: false,
			forceNoSystemMessages: false,
		},
		...config,
	}
	return {
		config: sourceConfig,
		source: await generator.interfaces.serviceGenerator.GetSource(sourceConfig, { SaveConfig: onSave }),
	}
}

Deno.test('proxy Responses mode replays the growing history in output-compatible shape', async () => {
	const mock = mockJsonFetch(strictResponsesHandler('mock-answer'))
	try {
		const { source } = await makeSource({})
		const conversation = createPromptStructConversation({ charName: 'ZL-31', userName: 'Tester' })

		conversation.addUser('first question')
		const first = await source.StructCall(conversation.makePromptStruct(), {})
		assertEquals(first.content, 'mock-answer')
		conversation.addChar(first.content)
		// 工具处理后的展示层可能被隐藏；下一轮的纯文本回复必须重建展示层。
		first.content_for_show = ''

		conversation.addUser('second question')
		const second = await source.StructCall(conversation.makePromptStruct(), { base_result: first })
		assertEquals(second.content, 'mock-answer')
		assertEquals(second.content_for_show ?? second.content, 'mock-answer')

		assertEquals(mock.calls.map(call => call.url), [
			'https://example.com/v1/responses',
			'https://example.com/v1/responses',
		])

		const body = JSON.parse(mock.calls[1].init.body)
		assertEquals(typeof body.instructions, 'string')
		assertEquals(body.input.map(item => item.role), ['user', 'assistant', 'user'])
		assertEquals(body.input[0].type, 'message')
		assertEquals(body.input[1].type, 'message')
		assertEquals(body.input[1].role, 'assistant')
		assertEquals(Array.isArray(body.input[1].content), true)
		assertEquals(body.input[1].content[0].type, 'output_text')
		assert(body.input[1].content[0].text.includes(first.content))
		assertEquals(body.input[2].type, 'message')
		assertEquals('messages' in body, false)
		assertEquals('n' in body, false)
		assertEquals('logprobs' in body, false)
		assertEquals('top_logprobs' in body, false)
	}
	finally {
		mock.restore()
	}
})

Deno.test('proxy auto mode keeps using the Responses endpoint for later turns after a fallback', async () => {
	const mock = mockJsonFetch(request => {
		if (request.url.endsWith('/chat/completions'))
			return new Response(JSON.stringify({ error: { message: 'Endpoint is unavailable.' } }), { status: 503 })
		return strictResponsesHandler('fallback-answer')(request)
	})
	try {
		const { config, source } = await makeSource({ url: 'https://example.com/v1/chat/completions', api_mode: 'auto' })
		const conversation = createPromptStructConversation({ charName: 'ZL-31', userName: 'Tester' })

		conversation.addUser('first question')
		const first = await source.StructCall(conversation.makePromptStruct(), {})
		assertEquals(first.content, 'fallback-answer')
		assertEquals(config.url, 'https://example.com/v1/responses')
		conversation.addChar(first.content)

		conversation.addUser('second question')
		const second = await source.StructCall(conversation.makePromptStruct(), {})
		assertEquals(second.content, 'fallback-answer')

		assertEquals(mock.calls.map(call => call.url), [
			'https://example.com/v1/chat/completions',
			'https://example.com/v1/responses',
			'https://example.com/v1/responses',
		])
		const secondBody = JSON.parse(mock.calls[2].init.body)
		assertEquals(secondBody.input.map(item => item.role), ['user', 'assistant', 'user'])
		assertEquals(secondBody.input[1].content[0].type, 'output_text')
		assert(secondBody.input[1].content[0].text.includes(first.content))
	}
	finally {
		mock.restore()
	}
})
