import { LoadChar } from '../../../server/managers/char_manager.mjs'
import { GetDefaultShellAssistInterface } from './src/server/default_interface/main.mjs'
import { setEndpoints } from './src/server/endpoints.mjs'

export default {
	info: {
		'': {
			name: 'shellassist',
			avatar: '',
			description: 'Interactive terminal access within fount.',
			description_markdown: 'Provides an interactive terminal connected to the fount server environment.',
			version: '1.0.0',
			author: 'steve02081504',
			homepage: '',
			tags: ['terminal', 'shell', 'interactive']
		}
	},
	Load: ({ router }) => {
		setEndpoints(router)
	},
	Unload: () => { },
	interfaces: {
		invokes: {
			IPCInvokeHandler: async (username, data) => {
				const char = await LoadChar(username, data.charname)
				char.interfaces.shellassist ??= await GetDefaultShellAssistInterface(char, data.charname)
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
