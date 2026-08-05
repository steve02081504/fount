/**
 * GetCharReply 回落测试用 char（不应被调用）。
 */
export default {
	info: {
		'zh-CN': { name: 'GetCharReply char', avatar: '🤖', description: '', version: '1', author: 'fount', tags: ['test'] },
		'en-US': { name: 'GetCharReply char', avatar: '🤖', description: '', version: '1', author: 'fount', tags: ['test'] },
	},
	interfaces: {
		chat: {
			/** 故意抛错，断言 world GetCharReply 已接管。 */
			GetReply: async () => {
				throw new Error('char GetReply must not run when world GetCharReply returns')
			},
		},
	},
}
