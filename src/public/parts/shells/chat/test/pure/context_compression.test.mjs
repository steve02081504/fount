/**
 * 上下文压缩纯函数：needsCompression 依据 context_size 与阈值判定。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { needsCompression } from '../../src/chat/session/summarize.mjs'

/**
 * 构造只统计字符数的 AI 源桩。
 * @param {number} contextSize 上下文上限
 * @returns {object} AI 源桩
 */
function makeAiSource(contextSize) {
	return {
		context_size: contextSize,
		tokenizer: {
			/**
			 * 按 4 字符/token 估算。
			 * @param {string} text 文本
			 * @returns {number} token 数
			 */
			get_token_count: text => Math.ceil(text.length / 4),
		},
	}
}

Deno.test('needsCompression returns false without context_size', () => {
	assertEquals(needsCompression({ ai_source: {} }, { threshold: 0.5 }), false)
	assertEquals(needsCompression({}, { threshold: 0.5 }), false)
})

Deno.test('needsCompression compares usage against the threshold', () => {
	const ai_source = makeAiSource(400)
	const chatLog = [{ name: 'a', role: 'user', content: 'x'.repeat(1200) }]
	assertEquals(needsCompression({ ai_source, chat_log: chatLog }, { threshold: 0.5 }), true)
	const chatLogSmall = [{ name: 'a', role: 'user', content: 'x'.repeat(40) }]
	assertEquals(needsCompression({ ai_source, chat_log: chatLogSmall }, { threshold: 0.5 }), false)
})

Deno.test('needsCompression falls back to char estimate without a tokenizer', () => {
	const ai_source = { context_size: 100, tokenizer: null }
	const chatLog = [{ name: 'a', role: 'user', content: 'x'.repeat(1000) }]
	assertEquals(needsCompression({ ai_source, chat_log: chatLog }, { threshold: 0.9 }), true)
})

Deno.test('needsCompression honours an explicit prompt_struct over chat_log', () => {
	const ai_source = makeAiSource(4000)
	const prompt_struct = {
		char_id: 'c',
		char_prompt: { text: [], additional_chat_log: [] },
		user_prompt: { text: [], additional_chat_log: [] },
		world_prompt: { text: [], additional_chat_log: [] },
		plugin_prompts: {},
		other_chars_prompts: {},
		other_personas_prompts: {},
		chat_log: [{ name: 'a', role: 'user', content: 'small' }],
		timelines: [],
	}
	assertEquals(
		needsCompression({ ai_source, chat_log: [{ content: 'x'.repeat(1e5) }] }, { threshold: 0.5, prompt_struct }),
		false,
	)
})
