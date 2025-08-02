import { runBot, stopBot, getBotList, setBotConfig, deleteBotConfig, getBotConfig as getPartData, getBotConfigTemplate } from './src/server/bot.mjs'
import { setEndpoints } from './src/server/endpoints.mjs'

export default {
	info: {
		'': {
			name: 'discordbot',
			avatar: '',
			description: 'run your char as discord bot',
			description_markdown: 'default description',
			version: '1.0.0',
			author: 'steve02081504',
			home_page: '',
			tags: []
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
				const botname = args[1]

				switch (action) {
					case 'list':
						console.log(getBotList(user))
						break
					case 'create':
						if (!botname) throw new Error('Bot name is required for create action.')
						setBotConfig(user, botname, {})
						console.log(`Bot '${botname}' created.`)
						break
					case 'delete':
						if (!botname) throw new Error('Bot name is required for delete action.')
						await deleteBotConfig(user, botname)
						console.log(`Bot '${botname}' deleted.`)
						break
					case 'config':
						if (!botname) throw new Error('Bot name is required for config action.')
						const configData = JSON.parse(args[2])
						await setBotConfig(user, botname, configData)
						console.log(`Bot '${botname}' configured.`)
						break
					case 'get-config':
						if (!botname) throw new Error('Bot name is required for get-config action.')
						console.log(await getPartData(user, botname))
						break
					case 'get-template':
						const charname = args[1]
						if (!charname) throw new Error('Char name is required for get-template action.')
						console.log(await getBotConfigTemplate(user, charname))
						break
					case 'start':
						if (!botname) throw new Error('Bot name is required for start action.')
						await runBot(user, botname)
						break
					case 'stop':
						if (!botname) throw new Error('Bot name is required for stop action.')
						await stopBot(user, botname)
						break
					default:
						throw `Unknown action: ${action}. Available actions: list, create, delete, config, get-config, get-template, start, stop`
				}
			},
			IPCInvokeHandler: async (user, { action, botname, configData, charname }) => {
				switch (action) {
					case 'list':
						return getBotList(user)
					case 'create':
						if (!botname) throw new Error('Bot name is required for create action.')
						setBotConfig(user, botname, {})
						return `Bot '${botname}' created.`
					case 'delete':
						if (!botname) throw new Error('Bot name is required for delete action.')
						await deleteBotConfig(user, botname)
						return `Bot '${botname}' deleted.`
					case 'config':
						if (!botname) throw new Error('Bot name is required for config action.')
						await setBotConfig(user, botname, configData)
						return `Bot '${botname}' configured.`
					case 'get-config':
						if (!botname) throw new Error('Bot name is required for get-config action.')
						return getPartData(user, botname)
					case 'get-template':
						if (!charname) throw new Error('Char name is required for get-template action.')
						return getBotConfigTemplate(user, charname)
					case 'start':
						if (!botname) throw new Error('Bot name is required for start action.')
						await runBot(user, botname)
						return `Bot '${botname}' started.`
					case 'stop':
						if (!botname) throw new Error('Bot name is required for stop action.')
						await stopBot(user, botname)
						return `Bot '${botname}' stopped.`
					default:
						throw `Unknown action: ${action}. Available actions: list, create, delete, config, get-config, get-template, start, stop`
				}
			}
		},
		jobs: {
			ReStartJob: async (user, botname) => {
				let sleep_time = 0
				while (true) try {
					await runBot(user, botname)
					break
				} catch (error) {
					console.error(error)
					await new Promise(resolve => setTimeout(resolve, sleep_time))
					sleep_time += 1000
				}
			}
		}
	}
}