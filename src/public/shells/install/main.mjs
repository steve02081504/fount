import { setEndpoints } from './src/endpoints.mjs'

async function handleAction(user, action, params) {
	const { actions } = await import('./src/actions.mjs')
	if (!actions[action])
		throw new Error(`Unknown action: ${action}. Available actions: ${Object.keys(actions).join(', ')}`)

	return actions[action]({ user, ...params })
}

export default {
	info: {
		'': {
			name: 'install',
			avatar: '',
			description: 'default description',
			description_markdown: 'default description',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: []
		}
	},
	Load: ({ router }) => {
		setEndpoints(router)
	},

	interfaces: {
		invokes: {
			ArgumentsHandler: async (user, args) => {
				const action = args[0]
				let params = {}
				if (action === 'install')
					params = { input: args[1] }
				else if (action === 'uninstall')
					params = { partType: args[1], partName: args[2] }

				const result = await handleAction(user, action, params)
				console.log(result)
			},
			IPCInvokeHandler: async (user, data) => {
				const { action, ...params } = data
				return handleAction(user, action, params)
			}
		}
	}
}
