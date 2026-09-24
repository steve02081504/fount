/**
 * Change-Prompt 源 prompt 变换与 BuildPrompt 委托。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { buildChangedPromptStruct, buildPromptChanged, getSinglePartPrompt } from '../../prompt.mjs'

/**
 * 构造最小可用的 prompt_struct。
 * @returns {object} prompt_struct。
 */
function makePromptStruct() {
	return {
		char_id: 'char',
		UserCharname: 'User',
		ReplyToCharname: 'Char',
		UserUid: 'u1',
		CharUid: 'c1',
		ReplyToUid: 'c1',
		Charname: 'Char',
		char_prompt: { text: [] },
		user_prompt: { text: [] },
		world_prompt: { text: [] },
		other_chars_prompts: {},
		other_personas_prompts: {},
		plugin_prompts: {},
		chat_log: [],
	}
}

/**
 * 构造一个仅实现 BuildPrompt 的假基础源。
 * @param {(prompt_struct: object) => Promise<object>} buildPrompt - 构建函数。
 * @returns {object} 假源。
 */
function fakeSource(buildPrompt) {
	return { BuildPrompt: buildPrompt }
}

Deno.test('getSinglePartPrompt returns an empty part prompt', () => {
	assertEquals(getSinglePartPrompt(), { text: [], additional_chat_log: [], extension: {} })
})

Deno.test('buildChangedPromptStruct inserts changes at the configured depth', async () => {
	const config = {
		build_prompt: false,
		changes: [{ name: 'x', insert_depth: 0, content: { role: 'system', content: 'injected' } }],
	}
	const changed = await buildChangedPromptStruct(makePromptStruct(), config)
	assertEquals(changed.chat_log.length, 1)
	assertEquals(changed.chat_log[0].content, 'injected')
	assertEquals(changed.chat_log[0].role, 'system')
})

Deno.test('buildPromptChanged delegates the transformed prompt_struct to the base source', async () => {
	const prompt_struct = makePromptStruct()
	const config = { build_prompt: false, changes: [], replaces: [] }
	const base = fakeSource(async ps => ({ from: 'base', chat_log: ps.chat_log }))
	const result = await buildPromptChanged(prompt_struct, config, base)
	assertEquals(result, { from: 'base', chat_log: prompt_struct.chat_log })
})

Deno.test('buildPromptChanged returns empty object when base source lacks BuildPrompt', async () => {
	assertEquals(await buildPromptChanged(makePromptStruct(), { build_prompt: false, changes: [] }, {}), {})
})
