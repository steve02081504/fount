/**
 * M4：MessageEdit / MessageDelete / GetCharReply fixture。
 */
const HOOK_KEY = '__fount_m4_hook_state__'

/**
 * @returns {{ worldEditCalls: object[], worldDeleteCalls: object[] }}
 */
function hookState() {
	if (!globalThis[HOOK_KEY])
		globalThis[HOOK_KEY] = { beforeEditCalls: [], beforeDeleteCalls: [], worldEditCalls: [], worldDeleteCalls: [] }
	return globalThis[HOOK_KEY]
}

export default {
	info: {
		'zh-CN': { name: 'M4 edit world', avatar: '🌍', description: '', version: '1', author: 'fount', tags: ['test'] },
		'en-US': { name: 'M4 edit world', avatar: '🌍', description: '', version: '1', author: 'fount', tags: ['test'] },
	},
	interfaces: {
		chat: {
			GetGreeting: async () => ({ content: 'm4-world-ready' }),
			MessageEdit: async ctx => {
				hookState().worldEditCalls.push(ctx)
				const text = String(ctx.edited?.content || '')
				if (text.includes('world-edit-me'))
					return { edited: { type: 'text', content: text.replace('world-edit-me', 'world-edited') } }
			},
			MessageDelete: async ctx => {
				hookState().worldDeleteCalls.push(ctx)
				if (String(ctx.original?.content?.content || '').includes('world-delete-reject'))
					return { reject: 'world rejected delete' }
			},
			GetCharReply: async (_arg, charname) => ({
				content: `world-intercepted:${charname}`,
			}),
		},
	},
}
