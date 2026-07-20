/**
 * viewer GetChatLogForViewer — 对 user 与指定 char 隐藏标记消息，并可改写 marked-rewrite。
 * @type {import('../../../../../../../../../decl/worldAPI.ts').WorldAPI_t}
 */
export default {
	info: {
		'zh-CN': {
			name: 'Human viewer 测试世界',
			avatar: '👁',
			description: '对 user/viewer_agent 隐藏 hidden-marker；改写 world-rewrite-me',
			version: '1.0.0',
			author: 'fount',
			tags: ['test'],
		},
		'en-US': {
			name: 'Human viewer test world',
			avatar: '👁',
			description: 'Hides hidden-marker for user/viewer_agent; rewrites world-rewrite-me',
			version: '1.0.0',
			author: 'fount',
			tags: ['test'],
		},
	},
	interfaces: {
		chat: {
			/**
			 * @param {import('../../../../../../../../../decl/chatLog.ts').chatReplyRequest_t} arg 请求
			 * @param {import('../../../../../../../../../decl/chatLog.ts').chatViewer_t} viewer 观察者
			 * @returns {Promise<object[]>} 过滤后的日志
			 */
			GetChatLogForViewer: async (arg, viewer) => {
				const matchUser = viewer?.kind === 'user'
				const matchChar = viewer?.kind === 'char' && viewer.charname === 'viewer_agent'
				if (!matchUser && !matchChar) return arg.chat_log || []
				return (arg.chat_log || [])
					.filter(entry => !String(entry.content || '').includes('hidden-marker'))
					.map(entry => {
						const text = String(entry.content || '')
						if (!text.includes('world-rewrite-me')) return entry
						return {
							...entry,
							content: text.replace('world-rewrite-me', 'world-rewritten'),
							content_for_show: text.replace('world-rewrite-me', 'world-rewritten'),
						}
					})
			},
		},
	},
}
