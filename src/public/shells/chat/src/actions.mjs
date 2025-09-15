import {
	loadChat, addchar, newChat, setPersona, setWorld, getChatList, addUserReply, GetChatLog, GetChatLogLength,
	removechar, setCharSpeakingFrequency, getCharListOfChat, GetUserPersonaName, GetWorldName, modifyTimeLine,
	triggerCharReply, deleteMessage, editMessage
} from './chat.mjs'

export const actions = {
	start: async ({ user, charName }) => {
		const chatId = await newChat(user)
		if (charName) await addchar(chatId, charName)
		return chatId
	},
	asjson: async ({ user, chatInfo }) => {
		let chatId
		if (chatInfo.id) {
			chatId = chatInfo.id
			await loadChat(chatId, user)
		} else
			chatId = await newChat(user)


		if (chatInfo.world) await setWorld(chatId, chatInfo.world)
		if (chatInfo.persona) await setPersona(chatId, chatInfo.persona)
		if (chatInfo.chars)
			for (const char of chatInfo.chars)
				await addchar(chatId, char)


		return chatId
	},
	load: ({ chatId }) => {
		if (!chatId) throw new Error('Chat ID is required for load command.')
		return chatId
	},
	list: ({ user }) => getChatList(user),
	send: ({ chatId, message }) => {
		if (!chatId || !message) throw new Error('Chat ID and message are required for send command.')
		return addUserReply(chatId, message)
	},
	tail: async ({ chatId, n = 5 }) => {
		if (!chatId) throw new Error('Chat ID is required for tail command.')
		const logLength = await GetChatLogLength(chatId)
		return GetChatLog(chatId, Math.max(0, logLength - n), logLength)
	},
	'remove-char': ({ chatId, charName }) => {
		if (!chatId || !charName) throw new Error('Chat ID and character name are required.')
		return removechar(chatId, charName)
	},
	'set-persona': ({ chatId, personaName }) => {
		if (!chatId) throw new Error('Chat ID is required.')
		return setPersona(chatId, personaName || null)
	},
	'set-world': ({ chatId, worldName }) => {
		if (!chatId) throw new Error('Chat ID is required.')
		return setWorld(chatId, worldName || null)
	},
	'get-persona': ({ chatId }) => {
		if (!chatId) throw new Error('Chat ID is required.')
		return GetUserPersonaName(chatId)
	},
	'get-world': ({ chatId }) => {
		if (!chatId) throw new Error('Chat ID is required.')
		return GetWorldName(chatId)
	},
	'get-chars': ({ chatId }) => {
		if (!chatId) throw new Error('Chat ID is required.')
		return getCharListOfChat(chatId)
	},
	'set-char-frequency': ({ chatId, charName, frequency }) => {
		if (!chatId || !charName || !(Object(frequency) instanceof Number)) throw new Error('Chat ID, character name, and frequency are required.')
		return setCharSpeakingFrequency(chatId, charName, frequency)
	},
	'trigger-reply': ({ chatId, charName }) => {
		if (!chatId) throw new Error('Chat ID is required.')
		return triggerCharReply(chatId, charName || null)
	},
	'delete-message': ({ chatId, index }) => {
		if (!chatId || !(Object(index) instanceof Number)) throw new Error('Chat ID and message index are required.')
		return deleteMessage(chatId, index)
	},
	'edit-message': ({ chatId, index, newContent }) => {
		if (!chatId || !(Object(index) instanceof Number) || !newContent) throw new Error('Chat ID, message index, and new content are required.')
		return editMessage(chatId, index, newContent)
	},
	'modify-timeline': ({ chatId, delta }) => {
		if (!chatId || !(Object(delta) instanceof Number)) throw new Error('Chat ID and delta are required.')
		return modifyTimeLine(chatId, delta)
	}
}
