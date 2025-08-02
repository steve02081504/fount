
import { setEndpoints } from './src/server/endpoints.mjs'

export default {
	info: {
		'': {
			name: 'export',
			description: 'A shell to export fount parts.',
			version: '1.0.0',
			author: 'Gemini',
		},
	},
	Load: ({ router }) => {
		setEndpoints(router)
	},
	Unload: () => { },
}
