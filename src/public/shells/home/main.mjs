import { setEndpoints } from './src/server/endpoints.mjs'

export default {
	info: {
		'': {
			name: 'home',
			avatar: '',
			description: 'default description',
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
}
