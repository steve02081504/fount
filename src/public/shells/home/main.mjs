import { setEndpoints, unsetEndpoints } from './src/server/endpoints.mjs'

export default {
	info: {
		'': {
			name: 'home',
			avatar: '',
			description: 'default description',
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
}
