/* global Deno */
/**
 * roundContext 纯测试：封存旧追加上下文为 container、按 Update 差量追加新条目、保持时序且幂等。
 */
import { assert, assertEquals } from 'jsr:@std/assert'

import { CONTAINER_ENTRY_TYPE, isContainerEntry } from '../../src/chat/logEntryTypes.mjs'
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

Deno.test('injectRoundEntries seals old additional logs into a container and clears them', async () => {
	const base = entry('a', 'hello')
	const tool = { id: 't1', uid: 'system', role: 'tool', name: 'tool', content: 'result', charVisibility: ['c'] }
	const prompt = makePrompt({ chatLog: [base], additional: [tool] })
	const args = {
		char_id: 'c',
		/**
		 * 返回刷新后的 chat_log。
		 * @returns {Promise<{chat_log: object[]}>} 刷新结果
		 */
		Update: async () => ({ chat_log: [base] }),
	}

	await injectRoundEntries(args, prompt)

	assertEquals(prompt.char_prompt.additional_chat_log, [], '封存后追加日志桶应清空')
	assertEquals(prompt.chat_log.length, 2)
	const container = prompt.chat_log.at(-1)
	assert(isContainerEntry(container), '应追加 container 条目')
	assertEquals(container.type, CONTAINER_ENTRY_TYPE)
	assertEquals(container.charVisibility, ['c'])
	assertEquals(container.logContextAfter, [tool], '旧追加日志应放入 container.logContextAfter')
})

Deno.test('injectRoundEntries appends only new entries collected via Update, keeping order', async () => {
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

	// 合并后时序：基础消息 → 旧工具日志 → 新消息（container 自身不出现）
	const merged = mergeStructPromptChatLog(prompt).map(e => e.content)
	assertEquals(merged, ['hello', 'result', 'world'])
	assertEquals(prompt.chat_log.map(e => e.id), ['a', prompt.chat_log[1].id, 'u2'])
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

Deno.test('injectRoundEntries tolerates a missing Update', async () => {
	const base = entry('a', 'hello')
	const prompt = makePrompt({ chatLog: [base] })
	await injectRoundEntries({ char_id: 'c' }, prompt)
	assertEquals(prompt.chat_log, [base])
})

Deno.test('injectRoundEntries clears pending triggers via args.ClearPendingMessages', async () => {
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
	}
	await injectRoundEntries(args, prompt)
	assertEquals(cleared, 1, '轮次刷新后应清除待触发标记')
})

Deno.test('injectRoundEntries clears pending triggers even without Update', async () => {
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
	}
	await injectRoundEntries(args, prompt)
	assertEquals(cleared, 1, 'container 封存即代表角色看到新内容')
})
