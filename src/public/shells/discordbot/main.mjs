import { runBot } from "./src/server/bot.mjs"
import { setEndpoints, unsetEndpoints } from "./src/server/endpoints.mjs"

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
		await runBot(user, botname)
	}
}
