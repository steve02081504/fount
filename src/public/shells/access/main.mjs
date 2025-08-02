import { actions } from './src/server/actions.mjs'
import qrcode from 'npm:qrcode-terminal'

async function handleAction(user, action, params) {
	if (!actions[action])
		throw new Error(`Unknown action: ${action}.`)

	return actions[action]({ user, ...params })
}

export default {
	info: {
		'': {
			name: 'access',
			avatar: '',
			description: 'default description',
			description_markdown: 'default description',
			version: '1.0.0',
			author: 'steve02081504',
			home_page: '',
			tags: []
		}
	},
	Load: async ({ router }) => { },
	Unload: async () => { },
	interfaces: {
		invokes: {
			ArgumentsHandler: async (user, args) => {
				const url = await handleAction(user, 'default', {})
				console.log(`Access fount on other devices in the same network via: ${url}`)
				qrcode.generate(url, { small: true })
			},
			IPCInvokeHandler: async (user, args) => {
				return handleAction(user, 'default', args)
			}
		}
	}
}

