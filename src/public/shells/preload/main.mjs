async function handleAction(user, action, params) {
	const { actions } = await import('./src/actions.mjs')
	if (!actions[action])
		throw new Error(`Unknown action: ${action}. Available actions: ${Object.keys(actions).join(', ')}`)

	return actions[action]({ user, ...params })
}

export default {
	info: {
		'': {
			name: 'preload',
			avatar: '',
			description: 'default description',
			description_markdown: 'default description',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: []
		}
	},
	Load: ({ router }) => { },
	Unload: ({ router }) => { },

	interfaces: {
		invokes: {
			ArgumentsHandler: async (user, args) => {
				await handleAction(user, 'default', { parttype: args[0], partname: args[1] })
			},
			IPCInvokeHandler: async (user, data) => {
				await handleAction(user, 'default', data)
			}
		}
	}
}
