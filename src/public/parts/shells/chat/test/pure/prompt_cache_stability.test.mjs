/* global Deno */
/**
 * prompt 缓存前缀稳定性测试：
 * - 跨代共享前缀：请求级 additional_chat_log 永远拼接在 chat_log 时间线之后，不封存进历史，
 *   故第 N 代与第 N+1 代的序列化共享前缀延伸到时间线末尾。
 * - 空载荷条目无关性：正文去空白为空且无附件的条目不在 prompt 中产生内容，
 *   无论该代是否出现该条目，序列化结果一致。
 * - 合成条目 id 确定性：同一 prompt_struct 重复合并得到相同的 feedback 条目 id。
 */
import { assert, assertEquals } from 'jsr:@std/assert'

import { mergeStructPromptChatLog } from '../../src/prompt_struct/index.mjs'
import { injectRoundEntries } from '../../src/reply/roundContext.mjs'

/**
 * 构造最小 prompt_struct。
 * @param {object} [options] 选项
 * @param {object[]} [options.chatLog] 基础 chat_log
 * @param {Record<string, object[]>} [options.pluginBuckets] 各插件提示的追加日志
 * @param {object[]} [options.charAdditional] char_prompt 的追加日志
 * @returns {object} prompt_struct
 */
function makePrompt({ chatLog = [], pluginBuckets = {}, charAdditional = [] } = {}) {
	return {
		char_id: 'c',
		chat_log: [...chatLog],
		user_prompt: { text: [], additional_chat_log: [] },
		world_prompt: { text: [], additional_chat_log: [] },
		other_chars_prompts: {},
		other_personas_prompts: {},
		plugin_prompts: Object.fromEntries(
			Object.entries(pluginBuckets).map(([name, entries]) => [name, { text: [], additional_chat_log: [...entries] }]),
		),
		char_prompt: { text: [], additional_chat_log: [...charAdditional] },
		timelines: [],
	}
}

/**
 * 构造一条消息条目。
 * @param {string} id id
 * @param {string} role 角色
 * @param {string} content 内容
 * @returns {object} 条目
 */
function message(id, role, content) {
	return { id, uid: role === 'char' ? 'char-uid' : 'user-uid', role, name: role, content, time_stamp: 0 }
}

/**
 * 构造一条请求级（每轮重生成）追加上下文条目。
 * @param {string} name 名称
 * @param {string} content 内容
 * @returns {object} 条目
 */
function requestScoped(name, content) {
	return { id: `scoped:${name}`, uid: 'system', role: 'system', name, content, time_stamp: 0 }
}

Deno.test('跨代共享前缀：请求级追加上下文不进入历史，时间线前缀稳定', async () => {
	const u0 = message('u0', 'user', 'hi')
	const u1 = message('u1', 'user', 'second')
	const u2 = message('u2', 'user', 'third')

	// 第 N 代：历史 + 一条请求级插件条目 + 一条请求级 char 条目
	const genN = makePrompt({
		chatLog: [u0],
		pluginBuckets: { cc: [requestScoped('cc-usage', 'usage:N')] },
		charAdditional: [requestScoped('char-extra', 'char-extra:N')],
	})
	const argsN = {
		char_id: 'c',
		/**
		 * 返回刷新后的权威时间线。
		 * @returns {Promise<{chat_log: object[]}>} 刷新结果
		 */
		Update: async () => ({ chat_log: [u0, u1] }),
	}
	await injectRoundEntries(argsN, genN)
	// 模拟本轮生成时间线：原始生成先于本轮工具日志插入
	const toolEntry = { id: 't1', uid: 'system', role: 'tool', name: 'tool', content: 'result', charVisibility: ['c'] }
	const rawEntry = { id: 'c1', uid: 'char-uid', role: 'char', name: 'char', content: 'answer', charVisibility: ['c'] }
	genN.chat_log.push(rawEntry, toolEntry)

	const mergedN = mergeStructPromptChatLog(genN)
	/**
	 * 判断条目是否为请求级追加上下文。
	 * @param {object} entry 合并后的日志条目
	 * @returns {boolean} 是否请求级
	 */
	const isScoped = entry => /^(usage|char-extra):/.test(entry.content ?? '')
	assertEquals(mergedN.filter(isScoped).length, 2, '两条请求级条目应位于合并结果中')
	const scopedCount = mergedN.filter(isScoped).length
	const expectedPrefix = mergedN.slice(0, mergedN.length - scopedCount)
	assertEquals(expectedPrefix.map(entry => entry.content), ['hi', 'second', 'answer', 'result'])

	// 第 N+1 代：历史含已持久化的最终 char 条目（原始生成与工具日志存于 logContextBefore）+ 新用户消息；
	// 请求级插件条目同 id 但内容改变。
	const finalChar = {
		id: 'c1', uid: 'char-uid', role: 'char', name: 'char', content: 'answer', charVisibility: ['c'],
		logContextBefore: [rawEntry, toolEntry],
	}
	const genN1 = makePrompt({
		chatLog: [u0, u1, finalChar, u2],
		pluginBuckets: { cc: [requestScoped('cc-usage', 'usage:N+1')] },
		charAdditional: [requestScoped('char-extra', 'char-extra:N+1')],
	})
	const mergedN1 = mergeStructPromptChatLog(genN1)
	assertEquals(
		mergedN1.slice(0, expectedPrefix.length),
		expectedPrefix,
		'第 N+1 代合并结果应保留第 N 代去掉请求级尾部后的完整前缀',
	)
})

Deno.test('空载荷条目无关性：空正文且无附件的 char 条目不影响序列化', () => {
	const history = [message('u0', 'user', 'hi'), message('u1', 'user', 'second')]
	const without = makePrompt({ chatLog: history })
	const withEmpty = makePrompt({
		chatLog: [
			...history,
			{
				id: 'empty', uid: 'char-uid', role: 'char', name: 'char', content: '', files: [],
				content_for_show: '（人类展示层内容）',
				extension: { reasoning_content: '思考内容' },
				charVisibility: ['c'],
			},
		],
	})
	assertEquals(
		mergeStructPromptChatLog(withEmpty).map(entry => entry.content),
		mergeStructPromptChatLog(without).map(entry => entry.content),
		'仅含展示层/思考的条目不得产生 prompt 内容',
	)
})

Deno.test('合成 feedback 条目 id 确定：重复合并结果一致', () => {
	const entry = {
		...message('m1', 'user', 'hi'),
		extension: { feedback: { type: 'up', content: '好' } },
	}
	const prompt = makePrompt({ chatLog: [entry] })
	const first = mergeStructPromptChatLog(prompt).find(row => row.name === 'feedback')
	const second = mergeStructPromptChatLog(prompt).find(row => row.name === 'feedback')
	assert(first?.id, 'feedback 条目应带确定性 id')
	assertEquals(first.id, second.id)
	assertEquals(first.id, 'm1:feedback')
})
