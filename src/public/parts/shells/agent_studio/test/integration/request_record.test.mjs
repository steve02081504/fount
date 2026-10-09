/* global Deno */
/**
 * request_record 集成测试：主动记录 API 的身份解析、逐轮采集、缺失 chat_id 的降级与复核对话。
 */
import { assert, assertEquals } from 'jsr:@std/assert'

import { beginPromptRequest, collectGenerationRecord, finishPromptRequest } from '../../src/request_record.mjs'

/**
 * 构造完整的假 prompt_struct。
 * @param {object} [chatLog] 聊天日志
 * @returns {object} prompt_struct
 */
function makePromptStruct(chatLog = [
	{ id: 'm1', role: 'user', name: 'User', uid: 'user', content: 'hi' },
]) {
	return {
		char_id: 'demo-char',
		Charname: 'Demo',
		UserCharname: 'User',
		UserUid: 'user',
		CharUid: 'char',
		char_prompt: { text: [{ content: 'you are demo', important: 0 }], additional_chat_log: [], extension: {} },
		user_prompt: { text: [], additional_chat_log: [], extension: {} },
		world_prompt: { text: [], additional_chat_log: [], extension: {} },
		other_chars_prompts: {},
		other_personas_prompts: {},
		plugin_prompts: {},
		chat_log: chatLog,
		timelines: [],
		locales: [],
	}
}

/**
 * 构造请求。
 * @param {object} [overrides] 覆盖字段
 * @returns {object} 请求
 */
function makeArgs(overrides = {}) {
	return {
		username: 'alice',
		chat_id: 'common_chat_g::default',
		char_id: 'demo-char',
		Charname: 'Demo',
		CharUid: 'char',
		extension: { generationId: 'gen-1', agentStudio: { source: 'shells/chat' } },
		...overrides,
	}
}

Deno.test('collectGenerationRecord builds a record with grouped identity and replayed dialogue', async () => {
	const args = makeArgs()
	const handle = await beginPromptRequest(args, makePromptStruct(), { model: 'demo-model' })
	finishPromptRequest(handle)
	const record = collectGenerationRecord(args, { response: 'bye' })

	assert(record)
	assertEquals(record.id, 'gen-1')
	assertEquals(record.chatId, 'common_chat_g::default')
	assertEquals(record.conversationId, 'common_chat_g::default')
	assertEquals(record.source, 'shells/chat')
	assertEquals(record.charId, 'demo-char')
	assertEquals(record.requestCount, 1)
	assertEquals(record.response, 'bye')
	assertEquals(record.dialogue.events.length, 2)
	assertEquals(record.dialogue.events[0].message.id, 'm1')
	assertEquals(record.dialogue.events.at(-1).message.content, 'bye')
})

Deno.test('collectGenerationRecord returns null and warns when chat_id is missing', async () => {
	const args = makeArgs({ chat_id: undefined })
	const original = console.error
	const errors = []
	/**
	 * 捕获错误输出片段。
	 * @param {...any} parts 输出片段
	 * @returns {void}
	 */
	console.error = (...parts) => { errors.push(parts.join(' ')) }
	try {
		const handle = await beginPromptRequest(args, makePromptStruct())
		assertEquals(handle, null)
		assertEquals(collectGenerationRecord(args, { response: 'x' }), null)
	}
	finally {
		console.error = original
	}
	assertEquals(errors.length, 1)
	assert(errors[0].includes('chat_id'))
})

Deno.test('beginPromptRequest records message ids so consecutive rounds can align by id', async () => {
	const args = makeArgs()
	const first = await beginPromptRequest(args, makePromptStruct())
	finishPromptRequest(first, { output: 'hello' })
	const second = await beginPromptRequest(args, makePromptStruct([
		{ id: 'm1', role: 'user', name: 'User', uid: 'user', content: 'hi' },
		{ id: 'm2', role: 'char', name: 'Demo', uid: 'char', content: 'hello' },
	]))
	finishPromptRequest(second)
	const record = collectGenerationRecord(args, { response: 'again' })
	const ops = record.dialogue.events.map(event => event.op)
	assertEquals(record.requests[0].output, 'hello')
	assertEquals(ops, ['insert', 'insert', 'insert'])
	assertEquals(record.dialogue.events[1].message.id, 'm2')
})

Deno.test('finishPromptRequest stores only the calls added during that request', async () => {
	const args = makeArgs()
	const priorCall = { source: 'proxy', model: 'm', inputTokens: 10, outputTokens: 2 }
	const currentCall = { source: 'proxy', model: 'm', inputTokens: 12, outputTokens: 3 }
	args.generation_options = { base_result: { extension: { usage: { calls: [priorCall], total: {} } } } }
	const first = await beginPromptRequest(args, makePromptStruct())
	args.generation_options.base_result.extension.usage = { calls: [priorCall, currentCall], total: {} }
	finishPromptRequest(first, { output: 'round one' })

	const secondCall = { source: 'proxy', model: 'm', inputTokens: 14, outputTokens: 4 }
	const second = await beginPromptRequest(args, makePromptStruct())
	args.generation_options.base_result.extension.usage = { calls: [priorCall, currentCall, secondCall], total: {} }
	finishPromptRequest(second, { output: 'round two' })

	const record = collectGenerationRecord(args)
	assertEquals(record.requests[0].usage.calls, [currentCall])
	assertEquals(record.requests[0].usage.total.inputTokens, 12)
	assertEquals(record.requests[1].usage.calls, [secondCall])
	assertEquals(record.requests[1].usage.total.inputTokens, 14)
})

Deno.test('beginPromptRequest reports context estimates and closes the request interval', async () => {
	const args = makeArgs()
	const events = []
	/**
	 * 收集请求生命周期统计事件。
	 * @param {object} event - 请求统计事件。
	 * @returns {number} 收集后的条数。
	 */
	const collectStatistics = event => events.push({ ...event })
	args.generation_options = { onRequestStatistics: collectStatistics }
	const prompt = makePromptStruct()
	prompt.plugin_prompts = { demo: { text: [{ content: 'use tools wisely' }] } }
	const handle = await beginPromptRequest(args, prompt, { model: 'demo-model' })

	assertEquals(events.length, 1)
	assertEquals(events[0].model, 'demo-model')
	assertEquals(events[0].finishedAt, undefined)
	assertEquals(events[0].context.estimated, true)
	assert(events[0].context.components.tools > 0)
	assert(events[0].context.components.system > 0)
	assertEquals(events[0].context.components.other, events[0].context.total - events[0].context.components.system - events[0].context.components.tools - events[0].context.components.messages)

	finishPromptRequest(handle, { output: 'bye' })
	assertEquals(events.length, 2)
	assertEquals(events[1].callId, events[0].callId)
	assert(events[1].finishedAt >= events[1].startedAt)
})

Deno.test('request snapshots retain immutable attachment bytes and hashes', async () => {
	const bytes = new Uint8Array([1, 2, 3])
	const args = makeArgs()
	const prompt = makePromptStruct([{ id: 'file', role: 'user', content: '', files: [{ name: 'image.png', mime_type: 'image/png', buffer: bytes }] }])
	await beginPromptRequest(args, prompt)
	bytes.fill(0)
	const record = collectGenerationRecord(args)
	const file = record.requests[0].messages[0].files[0]
	assertEquals([...file.buffer], [1, 2, 3])
	assertEquals(file.hash.length, 64)
	assertEquals(record.dialogue.events[0].message.files[0].hash, file.hash)
})
