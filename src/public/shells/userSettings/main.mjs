import { setEndpoints } from './src/server/endpoints.mjs'

export default {
	info: {
		'': {
			name: 'user-settings',
			version: '1.0.0',
			author: 'steve02081504',
			description: 'Provides API endpoints for user settings management.'
		}
	},
	Load: async ({ router }) => {
		setEndpoints(router)
	},
	Unload: async () => { }
}
