/* global Deno */
/**
 * roundContext 纯测试：按 Update 差量追加新时间线条目、保持时序、幂等、各请求级追加上下文桶不受影响。
 */
import { assertEquals } from 'jsr:@std/assert'

import { mergeStructPromptChatLog } from '../../src/prompt_struct/index.mjs'
import { injectRoundEntries } from '../../src/reply/roundContext.mjs'

/**
 * 构造最小 prompt_struct（含各 part 的追加日志桶）。
 * @param {object} [options] 选项
 * @param {object[]} [options.chatLog] 基础 chat_log
 * @param {object[]} [options.additional] char_prompt 的追加日志
 * @returns {object} prompt_struct
 */
function makePrompt({ chatLog = [], additional = [] } = {}) {
	return {
		char_id: 'c',
		chat_log: [...chatLog],
		user_prompt: { text: [], additional_chat_log: [] },
		world_prompt: { text: [], additional_chat_log: [] },
		other_chars_prompts: {},
		other_personas_prompts: {},
		plugin_prompts: {},
		char_prompt: { text: [], additional_chat_log: [...additional] },
		timelines: [],
	}
}

/**
 * 构造一个日志条目。
 * @param {string} id id
 * @param {string} content 内容
 * @returns {object} 条目
 */
function entry(id, content) {
	return { id, uid: 'user', role: 'user', name: 'U', content, time_stamp: 0 }
}

Deno.test('injectRoundEntries appends fresh timeline entries after existing ones and leaves additional buckets untouched', async () => {
	const base = entry('a', 'hello')
	const tool = { id: 't1', uid: 'system', role: 'tool', name: 'tool', content: 'result', charVisibility: ['c'] }
	const fresh = entry('u2', 'world')
	const prompt = makePrompt({ chatLog: [base], additional: [tool] })
	const args = {
		char_id: 'c',
		/**
		 * 返回刷新后的 chat_log。
		 * @returns {Promise<{chat_log: object[]}>} 刷新结果
		 */
		Update: async () => ({ chat_log: [base, fresh] }),
	}

	await injectRoundEntries(args, prompt)

	assertEquals(prompt.chat_log.map(e => e.id), ['a', 'u2'], '新条目应追加到时间线末尾')
	assertEquals(prompt.char_prompt.additional_chat_log, [tool], '请求级追加桶不应被清空或封存')
	// 合并后时序：时间线（基础消息 → 新消息）→ 请求级追加上下文
	const merged = mergeStructPromptChatLog(prompt).map(e => e.content)
	assertEquals(merged, ['hello', 'world', 'result'])
})

Deno.test('injectRoundEntries registers timeline entries appended since the previous call', async () => {
	const base = entry('a', 'hello')
	const t1 = entry('t1', 'one')
	const t2 = entry('t2', 'two')
	const prompt = makePrompt({ chatLog: [base] })
	let round = 0
	const args = {
		char_id: 'c',
		/**
		 * 首轮返回 t1，次轮返回 t1 + 期间新增的 t2。
		 * @returns {Promise<{chat_log: object[]}>} 刷新结果
		 */
		Update: async () => ({ chat_log: round++ === 0 ? [base, t1] : [base, t1, t2] }),
	}

	await injectRoundEntries(args, prompt)
	prompt.chat_log.push(t2)
	await injectRoundEntries(args, prompt)

	assertEquals(prompt.chat_log.map(e => e.id), ['a', 't1', 't2'], '上一次调用后追加的时间线条目不应被重复加入')
})

Deno.test('injectRoundEntries is idempotent across repeated calls', async () => {
	const base = entry('a', 'hello')
	const fresh = entry('u2', 'world')
	const prompt = makePrompt({ chatLog: [base] })
	const args = {
		char_id: 'c',
		/**
		 * 返回刷新后的 chat_log。
		 * @returns {Promise<{chat_log: object[]}>} 刷新结果
		 */
		Update: async () => ({ chat_log: [base, fresh] }),
	}

	await injectRoundEntries(args, prompt)
	await injectRoundEntries(args, prompt)

	assertEquals(prompt.chat_log.filter(e => e.id === 'u2').length, 1, '新条目不应重复追加')
	assertEquals(prompt.chat_log.length, 2)
})

Deno.test('injectRoundEntries does not re-add timeline entries already present', async () => {
	const base = entry('a', 'hello')
	const t1 = entry('t1', 'one')
	const prompt = makePrompt({ chatLog: [base] })
	const args = {
		char_id: 'c',
		/**
		 * 返回已包含 t1 的刷新结果。
		 * @returns {Promise<{chat_log: object[]}>} 刷新结果
		 */
		Update: async () => ({ chat_log: [base, t1] }),
	}

	await injectRoundEntries(args, prompt)
	assertEquals(prompt.chat_log.map(e => e.id), ['a', 't1'])
})

Deno.test('injectRoundEntries tolerates a missing Update', async () => {
	const base = entry('a', 'hello')
	const prompt = makePrompt({ chatLog: [base] })
	await injectRoundEntries({ char_id: 'c' }, prompt)
	assertEquals(prompt.chat_log, [base])
})

Deno.test('injectRoundEntries calls Update with forRound by default', async () => {
	const base = entry('a', 'hello')
	const prompt = makePrompt({ chatLog: [base] })
	const seenOptions = []
	const args = {
		char_id: 'c',
		/**
		 * 记录 Refresh 选项并返回刷新后的 chat_log。
		 * @param {object} options 刷新选项
		 * @returns {Promise<{chat_log: object[]}>} 刷新结果
		 */
		Update: async options => {
			seenOptions.push(options)
			return { chat_log: [base] }
		},
	}
	await injectRoundEntries(args, prompt)
	assertEquals(seenOptions, [{ forRound: true }], '默认应由主轮次刷新消费唤醒')
})

Deno.test('injectRoundEntries calls Update without forRound when consumeWakes is false', async () => {
	const base = entry('a', 'hello')
	const prompt = makePrompt({ chatLog: [base] })
	const seenOptions = []
	const args = {
		char_id: 'c',
		/**
		 * 记录 Refresh 选项并返回刷新后的 chat_log。
		 * @param {object} options 刷新选项
		 * @returns {Promise<{chat_log: object[]}>} 刷新结果
		 */
		Update: async options => {
			seenOptions.push(options)
			return { chat_log: [base] }
		},
	}
	await injectRoundEntries(args, prompt, { consumeWakes: false })
	assertEquals(seenOptions, [{}], '二级 prompt 构建不应消费主槽位唤醒')
})

Deno.test('injectRoundEntries does not call ClearPendingMessages', async () => {
	const base = entry('a', 'hello')
	const prompt = makePrompt({ chatLog: [base] })
	let cleared = 0
	const args = {
		char_id: 'c',
		/**
		 * 记录清空调用。
		 * @returns {void}
		 */
		ClearPendingMessages: () => { cleared++ },
		/**
		 * 返回刷新后的 chat_log。
		 * @returns {Promise<{chat_log: object[]}>} 刷新结果
		 */
		Update: async () => ({ chat_log: [base] }),
	}
	await injectRoundEntries(args, prompt)
	assertEquals(cleared, 0, '清除待触发已改由 Update({ forRound: true }) 消费')
})

