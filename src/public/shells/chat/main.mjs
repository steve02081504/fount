import open from 'npm:open'
import { hosturl } from '../../../server/server.mjs'
import { addchar, newChat, setPersona, setWorld } from './src/server/chat.mjs'
import { loadChat } from './src/server/chat.mjs'
import { setEndpoints } from './src/server/endpoints.mjs'

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
	Load: (router) => {
		setEndpoints(router)
	},
	Unload: () => { },
	ArgumentsHandler: async (user, args) => {
		const command = args[0]
		let chatId

		if (command === 'start') {
			const charName = args[1]
			chatId = newChat(user)
			open(hosturl + '/shells/chat/#' + chatId)
			if (charName) await addchar(chatId, charName)

			console.log(`Started new chat with ID: ${chatId}${charName ? `, added character: ${charName}` : ''}`)
		} else if (command === 'asjson') {
			const chatInfo = JSON.parse(args[1])
			if (chatInfo.id)
				await loadChat(chatId = chatInfo.id, user)
			else
				chatId = newChat(user)

			if (chatInfo.world)
				await setWorld(chatId, chatInfo.world)
			if (chatInfo.persona)
				await setPersona(chatId, chatInfo.persona)
			if (chatInfo.chars)
				for (const char of chatInfo.chars)
					await addchar(chatId, char)

			console.log(`Loaded chat from JSON: ${args[1]}`)
		} else if (command === 'load') {
			chatId = args[1]
			if (!chatId) {
				console.error('Error: Chat ID is required for load command.')
				return
			}
			open(hosturl + '/shells/chat/#' + chatId)
			console.log(`Loaded chat with ID: ${chatId}`)
		}
		else
			console.error('Invalid command. Use "start [charName]" or "asjson [json]" or "load [chatId]".')
	}
}
