import { setEndpoints } from './src/server/main.mjs'

/** @type {import('../../../../decl/shellAPI.ts').ShellAPI_t} */
export default {
	info: {
		'': {
			name: 'EazyNew',
			description: 'Easily create new parts from templates.',
			version: '1.0.0',
			author: 'steve02081504',
			tags: ['tool', 'creator'],
		},
	},

	Load: async ({ router }) => {
		setEndpoints(router)
	},

	Unload: () => { },
}
