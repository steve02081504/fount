import { events } from '../../../server/events.mjs'

import { onPartInstalled, onPartUninstalled } from './src/api.mjs'
import { setEndpoints } from './src/endpoints.mjs'

export default {
	info: {
		'': {
			name: 'achievements',
			avatar: '',
			description: 'View and manage your achievements.',
			description_markdown: 'A shell to track your progress and milestones within fount.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['achievements', 'gamification', 'profile']
		}
	},
	Load: ({ router }) => {
		setEndpoints(router)
		events.on('part-installed', onPartInstalled)
		events.on('part-uninstalled', onPartUninstalled)
	},
	Unload: () => {
		events.off('part-installed', onPartInstalled)
		events.off('part-uninstalled', onPartUninstalled)
	},
}
