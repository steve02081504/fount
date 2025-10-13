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
			name: 'deskpet',
			avatar: '',
			description: 'run your char as a desktop pet',
			description_markdown: 'Allows characters to be displayed as interactive desktop pets in a borderless, transparent window.',
			version: '0.0.1',
			author: 'Gemini',
			home_page: '',
			tags: ['desktop', 'pet', 'webview']
		}
	},
	Load: async ({ router }) => {
		setEndpoints(router)
	},
	Unload: async () => { },

	interfaces: {
		invokes: {
			ArgumentsHandler: async (user, args) => {
				const [action, charname] = args
				const params = {
					charname
				}
				const result = await handleAction(user, action, params)
				if (result !== undefined)
					console.log(result)

			},
			IPCInvokeHandler: async (user, data) => {
				const { action, ...params } = data
				return handleAction(user, action, params)
			}
		},
		jobs: {
			ReStartJob: async (user, charname) => {
				const { runPet } = await import('./src/pet_runner.mjs')
				await runPet(user, charname)
			}
		}
	}
}
