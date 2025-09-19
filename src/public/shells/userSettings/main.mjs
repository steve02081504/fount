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
			name: 'user-settings',
			version: '0.0.1',
			author: 'steve02081504',
			description: 'Provides API endpoints for user settings management.'
		}
	},
	Load: async ({ router }) => {
		setEndpoints(router)
	},
	Unload: async () => { },
	interfaces: {
		invokes: {
			ArgumentsHandler: async (user, args) => {
				const action = args[0]
				const params = {}
				switch (action) {
					case 'change-password':
						params.currentPassword = args[1]
						params.newPassword = args[2]
						break
					case 'revoke-device':
						params.tokenJti = args[1]
						params.password = args[2]
						break
					case 'rename-user':
						params.newUsername = args[1]
						params.password = args[2]
						break
					case 'delete-account':
						params.password = args[1]
						break
					case 'create-apikey':
						params.description = args[1]
						break
					case 'revoke-apikey':
						params.jti = args[1]
						break
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
