/**
 * world MessageEdit / MessageDelete / GetCharReply fixture。
 */
const HOOK_KEY = '__fount_edit_path_hook_state__'

/**
 * @returns {{ worldEditCalls: object[], worldDeleteCalls: object[] }} globalThis 上共享的钩子计数器
 */
function hookState() {
	if (!globalThis[HOOK_KEY])
		globalThis[HOOK_KEY] = { beforeEditCalls: [], beforeDeleteCalls: [], worldEditCalls: [], worldDeleteCalls: [] }
	return globalThis[HOOK_KEY]
}

/**
 *
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
			 * @param {object} ctx 编辑钩子上下文
			 * @returns {Promise<object | undefined>} 改写结果或放行
			 */
			MessageEdit: async ctx => {
				hookState().worldEditCalls.push(ctx)
				const text = String(ctx.edited?.content || '')
				if (text.includes('world-edit-me'))
					return { edited: { type: 'text', content: text.replace('world-edit-me', 'world-edited') } }
			},
			/**
			 * @param {object} ctx 删除钩子上下文
			 * @returns {Promise<object | undefined>} 拒绝结果或放行
			 */
			MessageDelete: async ctx => {
				hookState().worldDeleteCalls.push(ctx)
				if (String(ctx.original?.content?.content || '').includes('world-delete-reject'))
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
