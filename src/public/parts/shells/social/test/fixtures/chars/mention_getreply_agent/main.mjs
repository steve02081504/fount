/**
 * M4：仅 chat.GetReply、无 social.OnMention。
 */
export default {
	info: {
		'zh-CN': { name: 'Mention fallback agent', avatar: '🤖', description: '', version: '1', author: 'fount', tags: ['test'] },
		'en-US': { name: 'Mention fallback agent', avatar: '🤖', description: '', version: '1', author: 'fount', tags: ['test'] },
	},
	interfaces: {
		chat: {
			GetReply: async () => ({ content: 'mention-getreply-fallback' }),
		},
	},
}
