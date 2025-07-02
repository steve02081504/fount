import { runBot, stopBot } from './src/server/bot.mjs'
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
				const botname = args[0]
				const action = args[1] ?? 'start'
				if (action === 'stop')
					await stopBot(user, botname)
				else if (action === 'start')
					await runBot(user, botname)
				else
					throw `Unknown action: ${action}`
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
