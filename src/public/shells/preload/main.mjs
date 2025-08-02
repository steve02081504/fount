import { actions } from './actions.mjs'

async function handleAction(user, params) {
	return actions.default({ user, ...params })
}

export default {
	info: {
		'': {
			name: 'preload',
			avatar: '',
			description: 'default description',
			description_markdown: 'default description',
			version: '1.0.0',
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
				await handleAction(user, { parttype: args[0], partname: args[1] })
			},
			IPCInvokeHandler: async (user, data) => {
				await handleAction(user, data)
			}
		}
	}
}

