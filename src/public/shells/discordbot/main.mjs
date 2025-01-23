import { runBot, stopBot } from './src/server/bot.mjs'
import { setEndpoints, unsetEndpoints } from './src/server/endpoints.mjs'

export default {
	info: {
		'': {
			name: 'discordbot',
			avatar: '',
			description: 'run your char as discord bot',
			description_markdown: 'default description',
			version: '1.0.0',
			author: 'steve02081504',
			homepage: '',
			tags: []
		}
	},
	Load: async (app) => {
		setEndpoints(app)
	},
	Unload: async (app) => {
		unsetEndpoints(app)
	},
	ArgumentsHandler: async (user, args) => {
		const botname = args[0]
		const action = args[1] ?? 'start'
		if (action === 'stop')
			await stopBot(user, botname)
		else if(action === 'start')
			await runBot(user, botname)
		else
			console.error(`Unknown action: ${action}`)
	}
}
