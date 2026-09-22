/* global Deno */
/**
 * prompt snapshot 纯函数测试：JSON 收敛、请求投影与轮次采集。
 */
import { assertEquals } from 'jsr:@std/assert'

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

Deno.test('createPromptRequestRecorder projects system prompt, messages and round index', () => {
	const recorder = createPromptRequestRecorder()
	const finish = recordPromptRequest(recorder, makePromptStruct(), { model: 'demo-model' })
	finish()
	assertEquals(recorder.requests.length, 1)
	const request = recorder.requests[0]
	assertEquals(request.index, 1)
	assertEquals(request.model, 'demo-model')
	assertEquals(typeof request.systemPrompt, 'string')
	assertEquals(request.systemPrompt.includes('you are demo'), true)
	assertEquals(request.messages, [{ role: 'user', name: 'alice', uid: 'user', content: 'hi' }])
	assertEquals(typeof request.finishedAt, 'number')

	recorder.record(makePromptStruct())
	assertEquals(recorder.requests.map(item => item.index), [1, 2])
})
