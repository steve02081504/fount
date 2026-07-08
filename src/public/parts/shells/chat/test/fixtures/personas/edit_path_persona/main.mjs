/**
 * persona BeforeUserEdit / BeforeUserDelete fixture。
 */
const HOOK_KEY = '__fount_edit_path_hook_state__'

/**
 * @returns {{ beforeEditCalls: object[], beforeDeleteCalls: object[] }} globalThis 上共享的钩子计数器
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
		'zh-CN': { name: 'Edit path test persona', avatar: '🧑', description: '', version: '1', author: 'fount', tags: ['test'] },
		'en-US': { name: 'Edit path test persona', avatar: '🧑', description: '', version: '1', author: 'fount', tags: ['test'] },
	},
	interfaces: {
		chat: {
			/** @returns {Promise<object>} 空 prompt 片段 */
			GetPrompt: async () => ({ text: [], additional_chat_log: [], extension: {} }),
			/**
			 * @param {object} ctx 编辑钩子上下文
			 * @returns {Promise<object | undefined>} 改写结果或放行
			 */
			BeforeUserEdit: async ctx => {
				hookState().beforeEditCalls.push(ctx)
				const text = String(ctx.edited?.content || '')
				if (text.includes('persona-edit-me'))
					return { edited: { type: 'text', content: text.replace('persona-edit-me', 'persona-edited') } }
			},
			/**
			 * @param {object} ctx 删除钩子上下文
			 * @returns {Promise<object | undefined>} 拒绝结果或放行
			 */
			BeforeUserDelete: async ctx => {
				hookState().beforeDeleteCalls.push(ctx)
				if (String(ctx.original?.content?.content || '').includes('persona-delete-reject'))
					return { reject: 'persona rejected delete' }
			},
		},
	},
}
