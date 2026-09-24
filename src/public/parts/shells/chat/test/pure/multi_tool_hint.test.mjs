/* global Deno */
/**
 * buildPromptStruct 在多工具标签处理器装配时注入「可在单次输出中同时使用多个标签」提示。
 */
import { assert, assertEquals } from 'jsr:@std/assert'

import { buildPromptStruct } from '../../src/prompt_struct/index.mjs'
import { defineReplyHandler, defineReplyHandlers } from '../../src/reply/defineReplyHandler.mjs'

/**
 * 造一个最小可用的叶子工具标签处理器。
 * @param {string} tag 标签名
 * @returns {object} ReplyHandler 叶子
 */
function stubHandler(tag) {
	return defineReplyHandler({
		tag,
		/**
		 * 空处理。
		 * @returns {Promise<object>} 结果
		 */
		handle: async () => ({}),
	})
}

/**
 * 构造 buildPromptStruct 所需的最小请求。
 * @param {Record<string, object>} plugins 插件表
 * @returns {object} 请求上下文
 */
function baseArgs(plugins) {
	return {
		char_id: 'char',
		Charname: 'Char',
		CharUid: 'char',
		UserCharname: 'User',
		UserUid: 'user',
		char: {
			interfaces: {
				chat: {
					/**
					 * 空角色提示。
					 * @returns {Promise<object>} 空 prompt
					 */
					GetPrompt: async () => ({ text: [], additional_chat_log: [], extension: {} }),
				},
			},
		},
		user: null,
		world: null,
		other_chars: {},
		other_personas: {},
		plugins,
		chat_log: [],
		timelines: [],
		locales: ['en-UK'],
		extension: {},
	}
}

/**
 * 取注入的多工具提示条目。
 * @param {object} prompt prompt_struct
 * @returns {object[]} 命中的提示条目
 */
function hintEntries(prompt) {
	return prompt.world_prompt.text.filter(text => text.description === 'multi-tool hint')
}

Deno.test('多个工具标签处理器时注入单次多用提示', async () => {
	const plugins = {
		a: { interfaces: { chat: { ReplyHandler: defineReplyHandlers([stubHandler('a1'), stubHandler('a2')]) } } },
	}
	const prompt = await buildPromptStruct(baseArgs(plugins))
	const hints = hintEntries(prompt)
	assertEquals(hints.length, 1, '应恰好注入一条提示')
	assert(hints[0].content.includes('单次回复'), '提示应说明可在单次回复中同时使用多个标签')
})

Deno.test('单个工具标签处理器时不注入', async () => {
	const plugins = { a: { interfaces: { chat: { ReplyHandler: stubHandler('only') } } } }
	const prompt = await buildPromptStruct(baseArgs(plugins))
	assertEquals(hintEntries(prompt).length, 0)
})

Deno.test('无工具标签处理器时不注入', async () => {
	const prompt = await buildPromptStruct(baseArgs({}))
	assertEquals(hintEntries(prompt).length, 0)
})
