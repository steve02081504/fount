import { setEndpoints } from './src/server/endpoints.mjs'
import { actions } from './actions.mjs'
import qrcode from 'npm:qrcode-terminal'

async function handleAction(user, params) {
	return actions.default({ user, ...params })
}

export default {
	info: {
		'': {
			name: 'proxy',
			avatar: '',
			description: 'default description',
			description_markdown: 'default description',
			version: '1.0.0',
			author: 'steve02081504',
			home_page: '',
			tags: []
		}
	},
	Load: ({ router }) => {
		setEndpoints(router)
	},
	Unload: () => { },
	interfaces: {
		invokes: {
			ArgumentsHandler: async (user, args) => {
				const url = await handleAction(user, {})
				console.log(`Your OpenAI-compatible API endpoint is: ${url}`)
				qrcode.generate(url, { small: true })
				console.log(`You can use it with any OpenAI-compatible client, for example, to list models, run: curl ${url}/v1/models -H "Authorization: Bearer <your_fount_token>"`)
			},
			IPCInvokeHandler: async (user, args) => {
				return handleAction(user, args)
			}
		}
	}
}
