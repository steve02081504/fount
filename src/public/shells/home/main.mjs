import { events } from '../../../server/events.mjs'

import { setEndpoints } from './src/endpoints.mjs'
import { onPartChanged } from './src/home.mjs'

export default {
	info: {
		'': {
			name: 'home',
			avatar: '',
			description: 'default description',
			description_markdown: 'default description',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: []
		}
	},
	Load: async ({ router }) => {
		setEndpoints(router)
		events.on('part-installed', onPartChanged)
		events.on('part-uninstalled', onPartChanged)
	},
	Unload: async () => {
		events.off('part-installed', onPartChanged)
		events.off('part-uninstalled', onPartChanged)
	},
}
