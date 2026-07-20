import { writePathHookState } from 'fount/public/parts/shells/chat/test/fixtures/probes/writePathHookState.mjs'

/**
 * 记录 AddChatLogEntry / AfterAddChatLogEntry 次数；可选改写 entry.content。
 * @type {import('../../../../../../../../../decl/worldAPI.ts').WorldAPI_t}
 */
export default {
	info: {
		'zh-CN': {
			name: '写路径钩子世界',
			avatar: '🧪',
			description: '记录 Add/After 钩子调用',
			version: '1.0.0',
			author: 'fount',
			tags: ['test'],
		},
		'en-US': {
			name: 'Write-path hook world',
			avatar: '🧪',
			description: 'Records Add/After hook calls',
			version: '1.0.0',
			author: 'fount',
			tags: ['test'],
		},
	},
	interfaces: {
		chat: {
			/**
			 * @param {object} arg chatReplyRequest
			 * @param {object} entry 拟落盘条目
			 * @returns {Promise<object>} 条目（可改写）
			 */
			AddChatLogEntry: async (arg, entry) => {
				writePathHookState.addCalls.push({
					channelId: arg?.extension?.channelId,
					content: entry?.content,
					role: entry?.role,
				})
				if (typeof entry?.content === 'string' && entry.content.includes('world-rewrite-me'))
					entry.content = entry.content.replace('world-rewrite-me', 'world-rewritten')
				return entry
			},
			/**
			 * @param {object} arg chatReplyRequest
			 * @param {object[]} freq 频率表
			 * @returns {Promise<void>}
			 */
			AfterAddChatLogEntry: async (arg, freq) => {
				writePathHookState.afterCalls.push({
					channelId: arg?.extension?.channelId,
					freqLen: Array.isArray(freq) ? freq.length : 0,
				})
			},
			/**
			 * @param {object} arg chatReplyRequest
			 * @param {number} _index 问候索引
			 * @returns {Promise<object>} 问候
			 */
			GetGreeting: async (arg, _index) => ({
				content: `world-greeting:${arg?.extension?.channelId || 'default'}`,
			}),
		},
	},
}
