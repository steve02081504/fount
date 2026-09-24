/* global Deno */
/**
 * prompt snapshot 纯函数测试：JSON 收敛、请求投影与轮次采集。
 */
import { assert, assertEquals } from 'jsr:@std/assert'

import { createPromptRequestRecorder, recordPromptRequest, sanitizeForJson } from '../../../chat/src/prompt_struct/snapshot.mjs'

/**
 * 无操作的占位函数，用于验证快照会剥离函数值。
 * @returns {void} 无
 */
const noop = () => { }

/**
 * 构造最小可用 prompt_struct。
 * @returns {object} prompt_struct
 */
function makePromptStruct() {
	return {
		char_id: 'demo-char',
		Charname: 'Demo',
		UserUid: 'user',
		CharUid: 'char',
		char_prompt: { text: [{ content: 'you are demo', important: 0 }], additional_chat_log: [], extension: {} },
		user_prompt: { text: [], additional_chat_log: [], extension: {} },
		world_prompt: { text: [], additional_chat_log: [], extension: {} },
		other_chars_prompts: {},
		other_personas_prompts: {},
		plugin_prompts: {},
		chat_log: [{ name: 'alice', uid: 'user', role: 'user', content: 'hi' }],
		timelines: [],
		locales: [],
	}
}

Deno.test('sanitizeForJson strips binary and functions', () => {
	const out = sanitizeForJson({
		name: 'x',
		when: new Date(0),
		bytes: new Uint8Array([1, 2, 3]),
		fn: noop,
		nested: { ok: true },
	})
	assertEquals(out.name, 'x')
	assertEquals(out.when, '1970-01-01T00:00:00.000Z')
	assertEquals(out.bytes, { $binary: true, byteLength: 3 })
	assertEquals('fn' in out, false)
	assertEquals(out.nested, { ok: true })
})

Deno.test('createPromptRequestRecorder projects system prompt, messages and round index', async () => {
	const recorder = createPromptRequestRecorder()
	const finish = await recordPromptRequest(recorder, makePromptStruct(), { model: 'demo-model' })
	finish()
	assertEquals(recorder.requests.length, 1)
	const request = recorder.requests[0]
	assertEquals(request.index, 1)
	assertEquals(request.model, 'demo-model')
	assertEquals(typeof request.systemPrompt, 'string')
	assertEquals(request.systemPrompt.includes('you are demo'), true)
	assertEquals(request.messages.length, 1)
	assertEquals(typeof request.messages[0].id, 'string')
	assert(request.messages[0].id.length > 0)
	assertEquals(
		{ ...request.messages[0], id: undefined },
		{ id: undefined, role: 'user', name: 'alice', uid: 'user', content: 'hi' },
	)
	assertEquals(typeof request.finishedAt, 'number')

	await recorder.record(makePromptStruct())
	assertEquals(recorder.requests.map(item => item.index), [1, 2])
})

Deno.test('createPromptRequestRecorder snapshots the AI source BuildPrompt structure', async () => {
	const recorder = createPromptRequestRecorder()
	const aiSource = {
		/**
		 * 模拟 AI 源的 BuildPrompt 出站结构。
		 * @returns {Promise<object>} 含 messages 与二进制附件的请求对象
		 */
		BuildPrompt: async () => ({ messages: [{ role: 'system', content: 'you are demo' }], bytes: new Uint8Array([1, 2, 3, 4]) })
	}
	await recordPromptRequest(recorder, makePromptStruct(), { aiSource })
	const snapshot = recorder.requests[0].snapshot
	assertEquals(typeof snapshot, 'string')
	assert(snapshot.includes('"messages"'))
	assert(snapshot.includes('you are demo'))
	assert(snapshot.includes('<buffer 4B'))
})
