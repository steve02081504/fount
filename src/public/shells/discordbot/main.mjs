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
	Load: (app) => {
		setEndpoints(app)
	},
	Unload: (app) => {
		unsetEndpoints(app)
	}
}
