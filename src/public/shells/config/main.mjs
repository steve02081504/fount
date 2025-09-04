import { setEndpoints } from './src/server/endpoints.mjs'

async function handleAction(user, action, params) {
	const { actions } = await import('./src/server/actions.mjs')
	if (!actions[action])
		throw new Error(`Unknown action: ${action}. Available actions: ${Object.keys(actions).join(', ')}`)

	return actions[action]({ user, ...params })
}

export default {
	info: {
		'': {
			name: 'config',
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
				const [action, partType, partName, jsonData] = args
				const params = {
					partType,
					partName,
					data: jsonData ? JSON.parse(jsonData) : undefined
				}
				const result = await handleAction(user, action, params)
				if (result !== undefined)
					console.log(result)

			},
			IPCInvokeHandler: async (user, data) => {
				const { action, ...params } = data
				return handleAction(user, action, params)
			}
		}
	}
}
