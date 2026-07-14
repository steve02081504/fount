/**
 * 仅 chat.GetReply、无 social.OnMessage。
 */
export default {
	info: {
		'zh-CN': { name: 'Mention fallback agent', avatar: '🤖', description: '', version: '1', author: 'fount', tags: ['test'] },
		'en-US': { name: 'Mention fallback agent', avatar: '🤖', description: '', version: '1', author: 'fount', tags: ['test'] },
	},
	interfaces: {
		chat: {
			/** @returns {Promise<object>} 固定回复 */
			GetReply: async () => ({ content: 'mention-getreply-fallback' }),
		},
	},
}
