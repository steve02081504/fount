/**
 * Proxy 的 Responses API 调用与自动回退。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { createPromptStructConversation } from 'fount/scripts/test/fixtures/ai_conversation.mjs'

import generator from '../../main.mjs'
import { mockJsonFetch, openaiMessageResponse, responsesOutputResponse } from '../mockFetch.mjs'

/**
 * 构造禁用持久化的 proxy 源。
 * @param {object} config - 覆盖配置。
 * @param {() => void} [onSave] - 配置保存回调。
 * @returns {Promise<object>} AI 源。
 */
async function makeSource(config, onSave = () => { }) {
	const sourceConfig = {
		name: 'proxy-responses',
		url: 'https://example.com/v1/chat/completions',
		model: 'mock-model',
		apikey: 'test-key',
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

Deno.test('proxy auto mode falls back from Chat Completions to Responses and stores the working URL', async () => {
	const mock = mockJsonFetch(({ url }) => url.endsWith('/chat/completions')
		? new Response(JSON.stringify({ error: { message: 'Endpoint is unavailable.' } }), { status: 503 })
		: responsesOutputResponse('responses-ok'))
	let saveCount = 0
	try {
		const { config, source } = await makeSource({ url: 'https://example.com/v1/chat/completions' }, () => { saveCount++ })
		const result = await source.Call('hello')

		assertEquals(result.content, 'responses-ok')
		assertEquals(mock.calls.map(call => call.url), [
			'https://example.com/v1/chat/completions',
			'https://example.com/v1/responses',
		])
		const responseBody = JSON.parse(mock.calls[1].init.body)
		assertEquals(responseBody.instructions, 'hello')
		assertEquals(responseBody.input, [])
		assertEquals(responseBody.temperature, 0)
		assertEquals('messages' in responseBody, false)
		assertEquals('n' in responseBody, false)
		assertEquals('logprobs' in responseBody, false)
		assertEquals(config.url, 'https://example.com/v1/responses')
		assertEquals(saveCount, 1)

		const conversation = createPromptStructConversation({ charName: 'ZL-31', userName: 'Tester' })
		conversation.addUser('build prompt')
		const prompt = await source.BuildPrompt(conversation.makePromptStruct())
		assertEquals(Array.isArray(prompt.input), true)
		assertEquals(prompt.model, 'mock-model')
	}
	finally {
		mock.restore()
	}
})

Deno.test('proxy auto mode falls back from Responses to Chat Completions', async () => {
	const mock = mockJsonFetch(({ url }) => url.endsWith('/responses')
		? new Response(JSON.stringify({ error: { message: 'Responses unsupported' } }), { status: 404 })
		: openaiMessageResponse('chat-ok'))
	try {
		const { source } = await makeSource({ url: 'https://example.com/v1/responses' })
		const result = await source.Call('hello')

		assertEquals(result.content, 'chat-ok')
		assertEquals(mock.calls.map(call => call.url), [
			'https://example.com/v1/responses',
			'https://example.com/v1/chat/completions',
		])
		const chatBody = JSON.parse(mock.calls[1].init.body)
		assertEquals(chatBody.messages, [{ role: 'system', content: 'hello' }])
	}
	finally {
		mock.restore()
	}
})
