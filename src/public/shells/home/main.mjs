import { events } from '../../../server/events.mjs'

import { setEndpoints } from './src/endpoints.mjs'
import { onPartInstalled, onPartUninstalled } from './src/home.mjs'

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
		events.on('part-installed', onPartInstalled)
		events.on('part-uninstalled', onPartUninstalled)
	},
	Unload: async () => {
		events.off('part-installed', onPartInstalled)
		events.off('part-uninstalled', onPartUninstalled)
	},
}
