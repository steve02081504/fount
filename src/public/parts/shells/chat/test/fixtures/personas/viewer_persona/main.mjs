import { viewerPersonaOrder } from 'fount/public/parts/shells/chat/test/fixtures/probes/viewerPersonaOrder.mjs'

/**
 * persona GetChatLogForViewer — 隐藏 persona-hide-me，改写 persona-rewrite-me；顺带断言 world 已先滤。
 * @type {import('../../../../../../../../../decl/userAPI.ts').UserAPI_t}
 */
export default {
	info: {
		'zh-CN': {
			name: 'Viewer 测试人格',
			avatar: '🧑',
			description: 'GetChatLogForViewer fixture',
			version: '1.0.0',
			author: 'fount',
			tags: ['test'],
		},
		'en-US': {
			name: 'Viewer test persona',
			avatar: '🧑',
			description: 'GetChatLogForViewer fixture',
			version: '1.0.0',
			author: 'fount',
			tags: ['test'],
		},
	},
	interfaces: {
		chat: {
			/**
			 * @returns {Promise<object>} prompt
			 */
			GetPrompt: async () => ({
				text: [{ content: 'viewer persona', important: 0 }],
				additional_chat_log: [],
				extension: {},
			}),
			/**
			 * @param {import('../../../../../../../../../decl/chatLog.ts').chatReplyRequest_t} arg 请求
			 * @param {import('../../../../../../../../../decl/chatLog.ts').chatViewer_t} viewer 观察者
			 * @returns {Promise<object[]>} 过滤后的日志
			 */
			GetChatLogForViewer: async (arg, viewer) => {
				if (viewer?.kind !== 'user') return arg.chat_log || []
				viewerPersonaOrder.worldHiddenStillPresent = (arg.chat_log || []).some(entry =>
					String(entry.content || '').includes('hidden-marker'))
				viewerPersonaOrder.called = true
				return (arg.chat_log || [])
					.filter(entry => !String(entry.content || '').includes('persona-hide-me'))
					.map(entry => {
						const text = String(entry.content || '')
						if (!text.includes('persona-rewrite-me')) return entry
						return {
							...entry,
							content: text.replace('persona-rewrite-me', 'persona-rewritten'),
							content_for_show: text.replace('persona-rewrite-me', 'persona-rewritten'),
						}
					})
			},
		},
	},
}
