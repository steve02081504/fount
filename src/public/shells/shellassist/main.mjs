import { LoadChar } from '../../../server/managers/char_manager.mjs'

import { setEndpoints } from './src/endpoints.mjs'

export default {
	info: {
		'': {
			name: 'shellassist',
			avatar: '',
			description: 'Interactive terminal access within fount.',
			description_markdown: 'Provides an interactive terminal connected to the fount server environment.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['terminal', 'shell', 'interactive']
		}
	},
	Load: ({ router }) => {
		setEndpoints(router)
	},
	interfaces: {
		invokes: {
			IPCInvokeHandler: async (username, data) => {
				const char = await LoadChar(username, data.charname)
				if (!char.interfaces.shellassist) {
					const { GetDefaultShellAssistInterface } = await import('./src/default_interface/main.mjs')
					char.interfaces.shellassist = await GetDefaultShellAssistInterface(char, username, data.charname)
				}
				const result = await char.interfaces.shellassist.Assist({
					...data,
					username,
					UserCharname: data.UserCharname || username,
					chat_scoped_char_memory: data.chat_scoped_char_memorys[data.charname] || {},
					chat_scoped_char_memorys: undefined
				})
				return {
					...result,
					chat_scoped_char_memorys: {
						...data.chat_scoped_char_memorys,
						[data.charname]: result.chat_scoped_char_memory
					},
					chat_scoped_char_memory: undefined
				}
			}
		}
	}
}
