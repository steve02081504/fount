import { exec } from '../../../server/exec.mjs'

let endpoints
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
	Init: async () => { await exec('npm install --save-optional discord.js') },
	Load: async (app) => {
		endpoints = await import('./src/server/endpoints.mjs')
		endpoints.setEndpoints(app)
	},
	Unload: async (app) => {
		endpoints.unsetEndpoints(app)
	},
	ArgumentsHandler: async (user, args) => {
		let module = await import('./args.mjs')
		await module.default(user, args)
	}
}
