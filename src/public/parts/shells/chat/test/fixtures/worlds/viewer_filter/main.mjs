/**
 * viewer GetChatLogForViewer — 对指定 charname 隐藏标记消息。
 * @type {import('../../../../../../../../../decl/worldAPI.ts').WorldAPI_t}
 */
export default {
	info: {
		'zh-CN': {
			name: 'Viewer 对称测试世界',
			avatar: '👁',
			description: '对 viewer.charname=viewer_agent 隐藏 hidden-marker',
			version: '1.0.0',
			author: 'fount',
			tags: ['test'],
		},
		'en-US': {
			name: 'Viewer parity test world',
			avatar: '👁',
			description: 'Hides hidden-marker for viewer.charname=viewer_agent',
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
				if (viewer?.kind === 'char' && viewer.charname === 'viewer_agent')
					return (arg.chat_log || []).filter(entry => !String(entry.content || '').includes('hidden-marker'))
				return arg.chat_log || []
			},
		},
	},
}
