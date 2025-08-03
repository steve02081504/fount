async function handleAction(user, action, params) {
	const { actions } = await import('./src/server/actions.mjs')
	if (!actions[action])
		throw new Error(`Unknown action: ${action}. Available actions: ${Object.keys(actions).join(', ')}`)

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
				const qrcode = await import('npm:qrcode-terminal')
				qrcode.generate(url, { small: true })
			},
			IPCInvokeHandler: async (user, args) => {
				return handleAction(user, 'default', args)
			}
		}
	}
}
