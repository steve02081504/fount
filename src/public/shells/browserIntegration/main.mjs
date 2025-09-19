import { setEndpoints } from './src/endpoints.mjs'

export default {
	info: {
		'': {
			name: 'browser_integration',
			avatar: '',
			description: 'Userscript for enhanced browser interaction.',
			description_markdown: 'Provides a userscript to allow characters to interact with the browser page content more natively.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['userscript', 'browser', 'integration']
		}
	},
	Load: ({ router }) => {
		setEndpoints(router)
	}
}
