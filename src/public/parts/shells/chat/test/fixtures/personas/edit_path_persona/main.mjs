import { editPathHookState } from 'fount/public/parts/shells/chat/test/fixtures/probes/editPathHookState.mjs'

/**
 * persona BeforeUserEdit / BeforeUserDelete fixture。
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
			 * @param {object} context 编辑钩子上下文
			 * @returns {Promise<object | undefined>} 改写结果或放行
			 */
			BeforeUserEdit: async context => {
				editPathHookState.beforeEditCalls.push(context)
				const text = String(context.edited?.content || '')
				if (text.includes('persona-edit-me'))
					return { edited: { type: 'text', content: text.replace('persona-edit-me', 'persona-edited') } }
			},
			/**
			 * @param {object} context 删除钩子上下文
			 * @returns {Promise<object | undefined>} 拒绝结果或放行
			 */
			BeforeUserDelete: async context => {
				editPathHookState.beforeDeleteCalls.push(context)
				if (String(context.original?.content?.content || '').includes('persona-delete-reject'))
					return { reject: 'persona rejected delete' }
			},
		},
	},
}
