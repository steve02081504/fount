import { setEndpoints } from './src/server/endpoints.mjs'

export default {
	info: {
		'': {
			name: 'proxy',
			avatar: '',
			description: 'default description',
			description_markdown: 'default description',
			version: '1.0.0',
			author: 'steve02081504',
			homepage: '',
			tags: []
		}
	},
	Load: (router) => {
		setEndpoints(router)
	},
	Unload: () => { }
}
