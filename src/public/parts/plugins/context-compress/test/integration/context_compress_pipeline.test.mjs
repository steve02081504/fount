/**
 * 【文件】test/integration/context_compress_pipeline.test.mjs
 * 【职责】集成层验证插件经真实 ReplyHandler 管线与 summarize.compressContext 串通：标签被识别、摘要落入 result、regen 触发、展示层折叠标签，并检查 interfaces 装配。
 * 【原理】直接调用 runReplyHandlers 驱动插件导出的 handler；以可控 aiSource.Call 桩替代网络，单进程、无 HTTP 节点。
 * 【关联】plugins/context-compress/main.mjs、handler.mjs、chat 的 handlerPipeline.mjs。
 */
/* global Deno */
import { assertEquals, assert } from 'jsr:@std/assert'

import { runReplyHandlers } from 'fount/public/parts/shells/chat/src/reply/handlerPipeline.mjs'

import plugin from '../../main.mjs'

/**
 * 构造一条聊天记录条目。
 * @param {'user'|'char'} role 角色
 * @param {string} name 显示名
 * @param {string} content 内容
 * @returns {object} 聊天记录条目
 */
function makeEntry(role, name, content) {
	return {
		id: crypto.randomUUID(),
		name,
		uid: role === 'char' ? 'char-uid' : 'user-uid',
		role,
		time_stamp: new Date().toISOString(),
		content,
	}
}

/**
 * 构造最小 prompt_struct。
 * @param {object[]} chatLog 聊天记录
 * @returns {object} prompt_struct 形状对象
 */
function makePromptStruct(chatLog) {
	/**
	 * @returns {object} 空单段 prompt
	 */
	const emptyPart = () => ({ text: [], additional_chat_log: [], extension: {} })
	return {
		char_id: 'char-1',
		Charname: 'Char',
		UserCharname: 'User',
		UserUid: 'user-uid',
		CharUid: 'char-uid',
		char_prompt: emptyPart(),
		user_prompt: emptyPart(),
		world_prompt: emptyPart(),
		plugin_prompts: {},
		other_chars_prompts: {},
		other_personas_prompts: {},
		chat_log: chatLog,
		timelines: [],
	}
}

/**
 * 构造返回固定摘要文本的 AI 源桩。
 * @param {string} text 预设摘要文本
 * @returns {{ Call: Function, context_size: number, tokenizer: null }} AI 源桩
 */
function makeAiSource(text) {
	/**
	 * 返回预设摘要文本。
	 * @returns {Promise<string>} 摘要文本
	 */
	const Call = async () => text
	return { Call, context_size: 1000, tokenizer: null }
}

Deno.test('compress tag runs through the real reply pipeline', async () => {
	const prompt_struct = makePromptStruct([
		makeEntry('user', 'User', '我们来写个长故事吧'),
		makeEntry('char', 'Char', '好呀，很久很久以前……'),
	])
	const args = {
		char_id: 'char-1',
		Charname: 'Char',
		CharUid: 'char-uid',
		UserUid: 'user-uid',
		chat_name: 'common_chat_test',
		locales: ['zh-CN'],
		ai_source: makeAiSource('整合后的摘要'),
		prompt_struct,
		extension: {},
	}
	const result = {
		content: '我先整理一下。<compress-context/>',
		content_for_show: '我先整理一下。<compress-context/>',
		logContextBefore: [],
		extension: {},
	}

	const regen = await runReplyHandlers(result, args, [plugin.interfaces.chat.ReplyHandler])
	assertEquals(regen, true)
	assertEquals(prompt_struct.chat_log.length, 1)
	assertEquals(prompt_struct.chat_log[0].type, 'summary')
	assertEquals(prompt_struct.chat_log[0].content, '整合后的摘要')

	const summaryLog = result.logContextBefore.find(entry => entry.type === 'summary')
	assert(summaryLog, '摘要条目应写入 result.logContextBefore')
	assertEquals(result.logContextBefore[0].role, 'char')
	assert(!result.content_for_show.includes('<compress-context'))
})

Deno.test('plugin interfaces are wired', async () => {
	assertEquals(typeof plugin.interfaces.chat.GetPrompt, 'function')
	assertEquals(typeof plugin.interfaces.chat.GetReplyPreviewUpdater, 'function')
	assertEquals(typeof plugin.interfaces.chat.GetReplyPreviewUpdater(), 'function')
	assert(plugin.interfaces.chat.ReplyHandler, 'ReplyHandler 应存在')

	const previous = await plugin.interfaces.config.GetData()
	await plugin.interfaces.config.SetData({ threshold: 0.5 })
	assertEquals((await plugin.interfaces.config.GetData()).threshold, 0.5)
	await plugin.interfaces.config.SetData(previous)
})
