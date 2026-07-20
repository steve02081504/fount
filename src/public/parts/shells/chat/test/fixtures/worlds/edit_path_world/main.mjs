import { editPathHookState } from 'fount/public/parts/shells/chat/test/fixtures/probes/editPathHookState.mjs'

/**
 * world MessageEdit / MessageDelete / GetCharReply fixture。
 */
export default {
	info: {
		'zh-CN': { name: 'Edit path test world', avatar: '🌍', description: '', version: '1', author: 'fount', tags: ['test'] },
		'en-US': { name: 'Edit path test world', avatar: '🌍', description: '', version: '1', author: 'fount', tags: ['test'] },
	},
	interfaces: {
		chat: {
			/** @returns {Promise<object>} 固定问候语 */
			GetGreeting: async () => ({ content: 'edit-path-world-ready' }),
			/**
			 * @param {object} context 编辑钩子上下文
			 * @returns {Promise<object | undefined>} 改写结果或放行
			 */
			MessageEdit: async context => {
				editPathHookState.worldEditCalls.push(context)
				const text = String(context.edited?.content || '')
				if (text.includes('world-edit-me'))
					return { edited: { type: 'text', content: text.replace('world-edit-me', 'world-edited') } }
			},
			/**
			 * @param {object} context 删除钩子上下文
			 * @returns {Promise<object | undefined>} 拒绝结果或放行
			 */
			MessageDelete: async context => {
				editPathHookState.worldDeleteCalls.push(context)
				if (String(context.original?.content?.content || '').includes('world-delete-reject'))
					return { reject: 'world rejected delete' }
			},
			/**
			 * @param {object} replyRequest 聊天回复请求（未用）
			 * @param {string} charname 被代言的角色
			 * @returns {Promise<object>} 世界代角色的回复
			 */
			GetCharReply: async (replyRequest, charname) => ({
				content: `world-intercepted:${charname}`,
			}),
		},
	},
}
