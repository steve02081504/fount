/**
 * Legacy 仅 GetChatLogForCharname — 对 charname=viewer_agent 隐藏标记消息。
 * @type {import('../../../../../../../../../decl/worldAPI.ts').WorldAPI_t}
 */
export default {
	info: {
		'zh-CN': {
			name: 'Legacy Charname 测试世界',
			avatar: '📜',
			description: '仅 GetChatLogForCharname',
			version: '1.0.0',
			author: 'fount',
			tags: ['test'],
		},
		'en-US': {
			name: 'Legacy charname test world',
			avatar: '📜',
			description: 'GetChatLogForCharname only',
			version: '1.0.0',
			author: 'fount',
			tags: ['test'],
		},
	},
	interfaces: {
		chat: {
			/**
			 * @param {import('../../../../../../../../../decl/chatLog.ts').chatReplyRequest_t} arg 请求
			 * @param {string} charname 角色名
			 * @returns {Promise<object[]>} 过滤后的日志
			 */
			GetChatLogForCharname: async (arg, charname) => {
				if (charname === 'viewer_agent')
					return (arg.chat_log || []).filter(entry => !String(entry.content || '').includes('hidden-marker'))
				return arg.chat_log || []
			},
		},
	},
}
