import { hosturl } from '../../../server/server.mjs'

import { setEndpoints } from './src/server/endpoints.mjs'
import { cleanFilesInterval } from './src/server/files.mjs'

let loading_count = 0

async function handleAction(user, action, params) {
	const { actions } = await import('./src/server/actions.mjs')
	if (!actions[action])
		throw new Error(`Unknown action: ${action}. Available actions: ${Object.keys(actions).join(', ')}`)

	return actions[action]({ user, ...params })
}

export default {
	info: {
		'': {
			name: 'chat',
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
		loading_count++
		setEndpoints(router)
	},
	Unload: () => {
		loading_count--
		if (loading_count === 0)
			clearInterval(cleanFilesInterval)
	},

	interfaces: {
		invokes: {
			ArgumentsHandler: async (user, args) => {
				const command = args[0]
				let params = {}
				let result

				switch (command) {
					case 'start':
						params = { charName: args[1] }
						result = await handleAction(user, command, params)
						console.log(`Started new chat at: ${hosturl}/shells/chat/#${result}`)
						break
					case 'asjson':
						params = { chatInfo: JSON.parse(args[1]) }
						result = await handleAction(user, command, params)
						console.log(`Loaded chat from JSON: ${args[1]}`)
						break
					case 'load':
						params = { chatId: args[1] }
						result = await handleAction(user, command, params)
						console.log(`Continue chat at: ${hosturl}/shells/chat/#${result}`)
						break
					case 'tail':
						params = { chatId: args[1], n: parseInt(args[2] || '5', 10) }
						result = await handleAction(user, command, params)
						result.forEach(log => {
							console.log(`[${new Date(log.time_stamp).toLocaleString()}] ${log.name}: ${log.content}`)
						})
						break
					case 'send':
						params = { chatId: args[1], message: { content: args[2] } }
						await handleAction(user, command, params)
						console.log(`Message sent to chat ${args[1]}`)
						break
					case 'edit-message':
						params = { chatId: args[1], index: parseInt(args[2], 10), newContent: { content: args.slice(3).join(' ') } }
						await handleAction(user, command, params)
						console.log(`Message at index ${args[2]} in chat ${args[1]} edited.`)
						break
					default: {
						const [chatId, ...rest] = args.slice(1)
						const paramMap = {
							'remove-char': { charName: rest[0] },
							'set-persona': { personaName: rest[0] },
							'set-world': { worldName: rest[0] },
							'set-char-frequency': { charName: rest[0], frequency: parseFloat(rest[1]) },
							'trigger-reply': { charName: rest[0] },
							'delete-message': { index: parseInt(rest[0], 10) },
							'modify-timeline': { delta: parseInt(rest[0], 10) }
						}
						params = { chatId, ...paramMap[command] }
						result = await handleAction(user, command, params)
						if (result !== undefined) console.log(result)
						break
					}
				}
			},
			IPCInvokeHandler: async (user, data) => {
				const { command, ...params } = data
				return handleAction(user, command, params)
			}
		}
	}
}
