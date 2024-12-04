import { addchar, newChat, setPersona, setWorld } from "./src/server/chat.mjs";
import { loadChat } from "./src/server/chat.mjs";
import { setEndpoints, unsetEndpoints } from "./src/server/endpoints.mjs"

export default {
	info: {
		'': {
			name: 'chat',
			avatar: '',
			description: 'default description',
			description_markdown: 'default description',
			version: '1.0.0',
			author: 'steve02081504',
			homepage: '',
			tags: []
		}
	},
	Load: (app) => {
		setEndpoints(app)
	},
	Unload: (app) => {
		unsetEndpoints(app)
	},
	ArgumentsHandler: async (user, args) => {
		const chatinfo = JSON.parse(args[0])
		let chatid
		if (chatinfo.id)
			await loadChat(chatid = chatinfo.id, user)
		else
			chatid = newChat(user)
		if (chatinfo.world)
			await setWorld(chatid, chatinfo.world, chatinfo.locale)
		if (chatinfo.persona)
			await setPersona(chatid, chatinfo.persona)
		if (chatinfo.chars)
			for (const charname of chatinfo.chars)
				await addchar(chatid, charname, chatinfo.locale)
	}
}
