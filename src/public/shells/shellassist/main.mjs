import { LoadChar } from '../../../server/managers/char_manager.mjs'

export default {
	info: {
		'': {
			name: 'install',
			avatar: '',
			description: 'default description',
			description_markdown: 'default description',
			version: '1.0.0',
			author: 'steve02081504',
			homepage: '',
			tags: []
		}
	},
	Load: (router) => { },
	Unload: (router) => { },

	interfaces: {
		invokes: {
			IPCInvokeHandler: async (username, data) => {
				const char = await LoadChar(username, data.charname)
				if (char?.interfaces?.shellassist) {
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
				else
					throw new Error(`Char ${data.char} does not support shellassist interface`)
			}
		}
	}
}
