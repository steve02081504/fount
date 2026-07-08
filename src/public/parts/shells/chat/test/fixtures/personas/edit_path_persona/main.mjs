/**
 * M4：BeforeUserEdit / BeforeUserDelete fixture。
 */
const HOOK_KEY = '__fount_m4_hook_state__'

/**
 * @returns {{ beforeEditCalls: object[], beforeDeleteCalls: object[] }}
 */
function hookState() {
	if (!globalThis[HOOK_KEY])
		globalThis[HOOK_KEY] = { beforeEditCalls: [], beforeDeleteCalls: [], worldEditCalls: [], worldDeleteCalls: [] }
	return globalThis[HOOK_KEY]
}

export default {
	info: {
		'zh-CN': { name: 'M4 edit persona', avatar: '🧑', description: '', version: '1', author: 'fount', tags: ['test'] },
		'en-US': { name: 'M4 edit persona', avatar: '🧑', description: '', version: '1', author: 'fount', tags: ['test'] },
	},
	interfaces: {
		chat: {
			GetPrompt: async () => ({ text: [], additional_chat_log: [], extension: {} }),
			BeforeUserEdit: async ctx => {
				hookState().beforeEditCalls.push(ctx)
				const text = String(ctx.edited?.content || '')
				if (text.includes('persona-edit-me'))
					return { edited: { type: 'text', content: text.replace('persona-edit-me', 'persona-edited') } }
			},
			BeforeUserDelete: async ctx => {
				hookState().beforeDeleteCalls.push(ctx)
				if (String(ctx.original?.content?.content || '').includes('persona-delete-reject'))
					return { reject: 'persona rejected delete' }
			},
		},
	},
}
