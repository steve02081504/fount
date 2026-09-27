/**
 * Proxy 的 Chat Completions 对 assistant（角色）历史附件的处理。
 *
 * 默认按「理想 API」原样发送，assistant 附件会触发严格后端 400；此时错误信息应附带
 * 指向 `convert_config.forbidAssistantFiles` 的提示。配置该降级后请求应成功。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assert, assertEquals } from 'jsr:@std/assert'

import { createPromptStructConversation } from 'fount/scripts/test/fixtures/ai_conversation.mjs'

import generator from '../../main.mjs'
import { mockJsonFetch, strictChatHandler } from '../mockFetch.mjs'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * 构造带一张角色图片附件的对话。
 * @returns {object} prompt_struct。
 */
function conversationWithAssistantImage() {
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
	return conversation.makePromptStruct()
}

/**
 * 构造禁用持久化的 proxy 源。
 * @param {string[]} forbidAssistantFiles - convert_config.forbidAssistantFiles。
 * @returns {Promise<object>} AI 源。
 */
async function makeSource(forbidAssistantFiles) {
	return generator.interfaces.serviceGenerator.GetSource({
		name: 'proxy-chat-assistant-file',
		url: 'https://example.com/v1/chat/completions',
		model: 'mock-model',
		apikey: 'test-key',
		api_mode: 'chat',
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
}

Deno.test('chat assistant attachment failure carries a forbidAssistantFiles hint', async () => {
	const mock = mockJsonFetch(strictChatHandler('ok'))
	try {
		const source = await makeSource([])
		let error
		try {
			await source.StructCall(conversationWithAssistantImage(), {})
		}
		catch (cause) {
			error = cause
		}
		assert(error, 'expected a request failure')
		assertEquals(error.name, 'AIRequestError')
		assertEquals(error.status, 400)
		assert(error.message.includes('forbidAssistantFiles'), 'error must point at forbidAssistantFiles')
	}
	finally {
		mock.restore()
	}
})

Deno.test('chat assistant attachment succeeds after forbidAssistantFiles downgrades it', async () => {
	const mock = mockJsonFetch(strictChatHandler('ok'))
	try {
		const source = await makeSource(['^image/'])
		const result = await source.StructCall(conversationWithAssistantImage(), {})
		assertEquals(result.content, 'ok')
		const body = JSON.parse(mock.calls[0].init.body)
		const downgraded = body.messages.find(message => message.role === 'assistant')
		assertEquals(downgraded, undefined, 'assistant history must be downgraded away')
	}
	finally {
		mock.restore()
	}
})
