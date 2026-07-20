/**
 * 按 viewer.roles 过滤 staff-only 消息。
 * @type {import('../../../../../../../../../decl/worldAPI.ts').WorldAPI_t}
 */
export default {
	info: {
		'zh-CN': {
			name: 'Roles 过滤测试世界',
			avatar: '🛡',
			description: 'moderator 角色可见 staff-only',
			version: '1.0.0',
			author: 'fount',
			tags: ['test'],
		},
		'en-US': {
			name: 'Roles filter test world',
			avatar: '🛡',
			description: 'staff-only visible with moderator role',
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
				const roles = viewer?.roles || []
				const isModerator = roles.includes('moderator')
				return (arg.chat_log || []).filter(entry => {
					const text = String(entry.content || '')
					if (text.includes('staff-only') && !isModerator) return false
					return true
				})
			},
		},
	},
}
