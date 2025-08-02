import { setEndpoints } from './src/server/main.mjs'
import { actions } from './actions.mjs'

async function handleAction(user, action, params) {
	if (!actions[action])
		throw new Error(`Unknown action: ${action}. Available actions: ${Object.keys(actions).join(', ')}`)

	return actions[action]({ user, ...params })
}

/** @type {import('../../../../decl/shellAPI.ts').ShellAPI_t} */
export default {
	info: {
		'': {
			name: 'EasyNew',
			description: 'Easily create new parts from templates.',
			version: '1.0.0',
			author: 'steve02081504',
			tags: ['tool', 'creator'],
		},
	},

	Load: async ({ router }) => {
		setEndpoints(router)
	},

	Unload: () => { },

	interfaces: {
		invokes: {
			ArgumentsHandler: async (user, args) => {
				const [action, templateName, partName, jsonData] = args
				const params = {
					templateName,
					partName,
					jsonData: jsonData ? JSON.parse(jsonData) : {}
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
