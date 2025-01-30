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
	Load: (app) => { },
	Unload: (app) => { },
	IPCInvokeHandler: async (user, data) => {
		const char = await LoadChar(user, data.charname)
		if (char?.interfaces?.shellassist)
			return char.interfaces.shellassist.Assist(data)
		else
			throw new Error(`Char ${data.char} does not support shellassist interface`)
	}
}
