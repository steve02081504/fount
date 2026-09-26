/**
 * Proxy 的 Responses API 对 assistant（角色）历史附件的处理。
 *
 * Responses 的 assistant 回合只接受 output_text / refusal，附件 part（input_image / input_audio）非法。
 * 是否把携带附件的 assistant 历史降级为 user 由 `convert_config.forbidAssistantFiles` 决定，与 Chat Completions 共用同一策略；默认不降级。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assert, assertEquals } from 'jsr:@std/assert'

import { createPromptStructConversation } from 'fount/scripts/test/fixtures/ai_conversation.mjs'

import generator from '../../main.mjs'
import { mockJsonFetch, strictResponsesHandler } from '../mockFetch.mjs'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * 构造带一张角色图片附件的对话并请求一次 Responses。
 * @param {string[]} forbidAssistantFiles - convert_config.forbidAssistantFiles。
 * @returns {Promise<object>} 解析后的 Responses 请求体。
 */
async function callWithAssistantImage(forbidAssistantFiles) {
	const mock = mockJsonFetch(strictResponsesHandler('ok'))
	try {
		const source = await generator.interfaces.serviceGenerator.GetSource({
			name: 'proxy-responses-assistant-file',
			url: 'https://example.com/v1/responses',
			model: 'mock-model',
			apikey: 'test-key',
			api_mode: 'responses',
			use_stream: false,
			model_arguments: {},
			convert_config: {
				roleReminding: false,
				assistantPrefill: false,
				ignoreFiles: [],
				forbidSystemFiles: [],
				forbidAssistantFiles,
				forceRoleAlternation: false,
				forceUserMessageEnding: false,
				forceNoSystemMessages: false,
			},
		}, {
			/**
			 * GetSource 依赖桩：空 SaveConfig。
			 * @returns {Promise<void>} 已完成。
			 */
			SaveConfig: async () => { },
		})

		const conversation = createPromptStructConversation({ charName: 'ZL-31', userName: 'Tester' })
		conversation.addUser('hi')
		conversation.chat_log.push({
			id: 'char-1',
			name: 'ZL-31',
			uid: 'char',
			role: 'char',
			content: 'look',
			files: [{
				name: 'a.png',
				mime_type: 'image/png',
				/**
				 * 返回非空 PNG 字节。
				 * @returns {Promise<Buffer>} PNG 字节。
				 */
				getBuffer: async () => PNG,
			}],
		})
		await source.StructCall(conversation.makePromptStruct(), {})
		return { body: JSON.parse(mock.calls[0].init.body), calls: mock.calls }
	}
	finally {
		mock.restore()
	}
}

Deno.test('proxy Responses keeps an assistant attachment as-is when forbidAssistantFiles is empty', async () => {
	const { body } = await callWithAssistantImage([])
	const assistant = body.input.find(item => item.role === 'assistant')
	assertEquals(assistant.content[0].type, 'output_text')
	assertEquals(assistant.content.some(part => part.type === 'input_image'), true)
})

Deno.test('proxy Responses downgrades an assistant attachment to user when forbidAssistantFiles hits', async () => {
	const { body } = await callWithAssistantImage(['^image/'])
	assertEquals(body.input.some(item => item.role === 'assistant'), false)
	const downgraded = body.input.find(item => item.role === 'user' && Array.isArray(item.content) && item.content.some(part => part.type === 'input_image'))
	assertEquals(downgraded.content[0].type, 'input_text')
	assert(downgraded.content[0].text.startsWith('assistant: '))
	assertEquals(downgraded.content.some(part => part.type === 'input_image'), true)
})
