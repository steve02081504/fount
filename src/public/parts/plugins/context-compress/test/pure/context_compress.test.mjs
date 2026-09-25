/**
 * 【文件】test/pure/context_compress.test.mjs
 * 【职责】纯函数层验证 `<compress-context/>` handler、GetPrompt（稳定工具说明）与 TweakPrompt（占用提示原地更新）：成功 regen、失败写工具日志、重复压缩防护、prompt 形状与占用提示。
 * 【原理】直接调用 handler 的 handle（真实 compressContext 路径），以可控 aiSource.Call 桩替换网络；prompt_struct 手工构造，零 I/O、零 server 依赖。
 * 【关联】plugins/context-compress/handler.mjs、prompt.mjs、state.mjs。
 */
/* global Deno */
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import { compressContextReplyHandler } from '../../handler.mjs'
import { applyContextUsageHint, getContextCompressPrompt, USAGE_ENTRY_ID } from '../../prompt.mjs'
import { getConfig, setConfig } from '../../state.mjs'

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
 * 构造一个最小可用的 prompt_struct。
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
 * @param {string} [text] 预设摘要文本
 * @returns {{ Call: Function, context_size: number, tokenizer: null }} AI 源桩
 */
function makeAiSource(text = 'summary text') {
	/**
	 * 返回预设摘要文本。
	 * @returns {Promise<string>} 摘要文本
	 */
	const Call = async () => text
	return { Call, context_size: 1000, tokenizer: null }
}

/**
 * 构造 handler 请求上下文，并收集工具日志。
 * @param {object} prompt_struct prompt 结构
 * @param {object|undefined} aiSource AI 源
 * @returns {{ args: object, logs: object[] }} 请求上下文与日志收集数组
 */
function makeArgs(prompt_struct, aiSource) {
	/** @type {object[]} */
	const logs = []
	/**
	 * 收集一条工具日志条目。
	 * @param {object} entry 日志条目
	 * @returns {void}
	 */
	const AddLongTimeLog = entry => { logs.push(entry) }
	return {
		logs,
		args: {
			char_id: 'char-1',
			Charname: 'Char',
			CharUid: 'char-uid',
			UserUid: 'user-uid',
			chat_name: 'common_chat_test',
			locales: ['zh-CN'],
			ai_source: aiSource,
			prompt_struct,
			AddLongTimeLog,
		},
	}
}

Deno.test('compress handler returns regen and pushes summary', async () => {
	const prompt_struct = makePromptStruct([
		makeEntry('user', 'User', '你好'),
		makeEntry('char', 'Char', '你好呀'),
	])
	const { args, logs } = makeArgs(prompt_struct, makeAiSource())
	const reply = { content: '好的<compress-context/>', logContextBefore: [] }

	const outcome = await compressContextReplyHandler.handle(reply, args, null)
	assertEquals(outcome, { regen: true })
	assertEquals(logs.length, 0)
	assertEquals(prompt_struct.chat_log.length, 1)
	assertEquals(prompt_struct.chat_log[0].type, 'summary')
	assertEquals(prompt_struct.chat_log[0].content, 'summary text')
	assertEquals(reply.logContextBefore.length, 1)
	assertEquals(reply.logContextBefore[0].type, 'summary')
})

Deno.test('compress handler logs when no AI source', async () => {
	const prompt_struct = makePromptStruct([makeEntry('user', 'User', '你好')])
	const { args, logs } = makeArgs(prompt_struct, undefined)
	const reply = { content: '<compress-context/>', logContextBefore: [] }

	const outcome = await compressContextReplyHandler.handle(reply, args, null)
	assertEquals(outcome, undefined)
	assertEquals(logs.length, 1)
	assertEquals(logs[0].role, 'tool')
	assertStringIncludes(logs[0].content, '没有可用的 AI 源')
	assertEquals(reply.logContextBefore.length, 0)
})

Deno.test('compress handler logs when nothing to compress', async () => {
	const prompt_struct = makePromptStruct([])
	const { args, logs } = makeArgs(prompt_struct, makeAiSource())
	const reply = { content: '<compress-context/>', logContextBefore: [] }

	const outcome = await compressContextReplyHandler.handle(reply, args, null)
	assertEquals(outcome, undefined)
	assertEquals(logs.length, 1)
	assertStringIncludes(logs[0].content, '没有可压缩')
})

Deno.test('compress handler does not compress the same result twice', async () => {
	const prompt_struct = makePromptStruct([makeEntry('user', 'User', '你好')])
	const { args, logs } = makeArgs(prompt_struct, makeAiSource())
	const reply = { content: '<compress-context/><compress-context/>', logContextBefore: [] }

	const first = await compressContextReplyHandler.handle(reply, args, null)
	assertEquals(first, { regen: true })
	const second = await compressContextReplyHandler.handle(reply, args, null)
	assertEquals(second, undefined)
	assertEquals(logs.length, 1)
})

Deno.test('GetPrompt returns a stable tool-only single-part shape', () => {
	const prompt = getContextCompressPrompt({
		locales: ['zh-CN'],
		ai_source: makeAiSource(''),
		chat_log: [makeEntry('user', 'User', 'a'.repeat(400))],
	})
	assertEquals(Array.isArray(prompt.text), true)
	assertEquals(prompt.text.length, 1)
	assertStringIncludes(prompt.text[0].content, '<compress-context/>')
	// 工具说明稳定：不含易变占用文本，也不注入 additional_chat_log
	assertEquals(prompt.text[0].content.includes('当前上下文占用'), false)
	assertEquals(prompt.additional_chat_log.length, 0)
	assertEquals(prompt.extension, {})
})

Deno.test('TweakPrompt appends a usage entry with a stable id', () => {
	const prompt_struct = makePromptStruct([makeEntry('user', 'User', 'a'.repeat(400))])
	const myPrompt = { text: [], additional_chat_log: [], extension: {} }
	applyContextUsageHint({ ai_source: makeAiSource('') }, prompt_struct, myPrompt)
	assertEquals(myPrompt.additional_chat_log.length, 1)
	const entry = myPrompt.additional_chat_log[0]
	assertEquals(entry.id, USAGE_ENTRY_ID)
	assertEquals(entry.extension.contextCompress, true)
	assertStringIncludes(entry.content, '模型上下文上限 1000 tokens')
	assertStringIncludes(entry.content, '%')
})

Deno.test('TweakPrompt updates the existing usage entry in place instead of appending', () => {
	const prompt_struct = makePromptStruct([makeEntry('user', 'User', 'a'.repeat(400))])
	const myPrompt = { text: [], additional_chat_log: [], extension: {} }
	applyContextUsageHint({ ai_source: makeAiSource('') }, prompt_struct, myPrompt)
	const firstContent = myPrompt.additional_chat_log[0].content
	// 追加更多历史后再更新：仍只有一条，内容变化
	prompt_struct.chat_log.push(makeEntry('char', 'Char', 'b'.repeat(4000)))
	applyContextUsageHint({ ai_source: makeAiSource('') }, prompt_struct, myPrompt)
	assertEquals(myPrompt.additional_chat_log.length, 1)
	assertEquals(myPrompt.additional_chat_log[0].id, USAGE_ENTRY_ID)
	assertEquals(myPrompt.additional_chat_log[0].content === firstContent, false)
})

Deno.test('TweakPrompt counts the assembled prompt_struct, not just chat_log', () => {
	const smallPrompt = makePromptStruct([makeEntry('user', 'User', 'hi')])
	const small = { text: [], additional_chat_log: [], extension: {} }
	applyContextUsageHint({ ai_source: makeAiSource('') }, smallPrompt, small)
	const largePrompt = makePromptStruct([makeEntry('user', 'User', 'hi')])
	// 给 char_prompt 注入大段系统提示：占用提示应随之增大
	largePrompt.char_prompt.text.push({ content: 'x'.repeat(20000), description: 'big', important: 0 })
	const large = { text: [], additional_chat_log: [], extension: {} }
	applyContextUsageHint({ ai_source: makeAiSource('') }, largePrompt, large)
	/**
	 * 从占用提示中提取估算 token 数。
	 * @param {string} text 占用提示文本
	 * @returns {number} 估算 token 数
	 */
	const count = text => Number(text.match(/约 (\d+) tokens/)[1])
	assertEquals(count(large.additional_chat_log[0].content) > count(small.additional_chat_log[0].content), true)
})

Deno.test('TweakPrompt nudges when usage reaches threshold', () => {
	const previous = getConfig()
	setConfig({ threshold: 0.01 })
	try {
		const prompt_struct = makePromptStruct([makeEntry('user', 'User', 'a'.repeat(400))])
		const myPrompt = { text: [], additional_chat_log: [], extension: {} }
		applyContextUsageHint({ ai_source: makeAiSource('') }, prompt_struct, myPrompt)
		assertStringIncludes(myPrompt.additional_chat_log[0].content, '接近上限')
	}
	finally {
		setConfig(previous)
	}
})

Deno.test('GetPrompt uses fixed Chinese copy regardless of locale', () => {
	const prompt = getContextCompressPrompt({
		locales: ['en-UK'],
		ai_source: undefined,
		chat_log: [],
	})
	assertStringIncludes(prompt.text[0].content, '压缩过长的对话历史')
})
