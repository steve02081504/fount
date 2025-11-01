import {
	loadChat, addchar, newChat, setPersona, setWorld, getChatList, addUserReply, GetChatLog, GetChatLogLength,
	removechar, setCharSpeakingFrequency, getCharListOfChat, GetUserPersonaName, GetWorldName, modifyTimeLine,
	triggerCharReply, deleteMessage, editMessage
} from './chat.mjs'

/**
 * 聊天操作
 */
export const actions = {
	/**
	 * 开始新聊天。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @param {string} root0.charName - 角色名称。
	 * @returns {Promise<string>} - 聊天ID。
	 */
	start: async ({ user, charName }) => {
		const chatId = await newChat(user)
		if (charName) await addchar(chatId, charName)
		return chatId
	},
	/**
	 * 以JSON格式加载聊天。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @param {object} root0.chatInfo - 聊天信息。
	 * @returns {Promise<string>} - 聊天ID。
	 */
	asjson: async ({ user, chatInfo }) => {
		let chatId
		if (chatInfo.id) {
			chatId = chatInfo.id
			await loadChat(chatId, user)
		}
		else chatId = await newChat(user)


		if (chatInfo.world) await setWorld(chatId, chatInfo.world)
		if (chatInfo.persona) await setPersona(chatId, chatInfo.persona)
		if (chatInfo.chars)
			for (const char of chatInfo.chars)
				await addchar(chatId, char)


		return chatId
	},
	/**
	 * 加载聊天。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.chatId - 聊天ID。
	 * @returns {string} - 聊天ID。
	 */
	load: ({ chatId }) => {
		if (!chatId) throw new Error('Chat ID is required for load command.')
		return chatId
	},
	/**
	 * 列出聊天。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @returns {Promise<Array<string>>} - 聊天列表。
	 */
	list: ({ user }) => getChatList(user),
	/**
	 * 发送消息。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.chatId - 聊天ID。
	 * @param {object} root0.message - 消息。
	 * @returns {Promise<void>}
	 */
	send: ({ chatId, message }) => {
		if (!chatId || !message) throw new Error('Chat ID and message are required for send command.')
		return addUserReply(chatId, message)
	},
	/**
	 * 查看最后几条消息。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.chatId - 聊天ID。
	 * @param {number} root0.n - 消息数量。
	 * @returns {Promise<Array<object>>} - 消息列表。
	 */
	tail: async ({ chatId, n = 5 }) => {
		if (!chatId) throw new Error('Chat ID is required for tail command.')
		const logLength = await GetChatLogLength(chatId)
		return GetChatLog(chatId, Math.max(0, logLength - n), logLength)
	},
	/**
	 * 移除角色。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.chatId - 聊天ID。
	 * @param {string} root0.charName - 角色名称。
	 * @returns {Promise<void>}
	 */
	'remove-char': ({ chatId, charName }) => {
		if (!chatId || !charName) throw new Error('Chat ID and character name are required.')
		return removechar(chatId, charName)
	},
	/**
	 * 设置角色。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.chatId - 聊天ID。
	 * @param {string} root0.personaName - 角色名称。
	 * @returns {Promise<void>}
	 */
	'set-persona': ({ chatId, personaName }) => {
		if (!chatId) throw new Error('Chat ID is required.')
		return setPersona(chatId, personaName || null)
	},
	/**
	 * 设置世界。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.chatId - 聊天ID。
	 * @param {string} root0.worldName - 世界名称。
	 * @returns {Promise<void>}
	 */
	'set-world': ({ chatId, worldName }) => {
		if (!chatId) throw new Error('Chat ID is required.')
		return setWorld(chatId, worldName || null)
	},
	/**
	 * 获取角色。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.chatId - 聊天ID。
	 * @returns {Promise<string>} - 角色名称。
	 */
	'get-persona': ({ chatId }) => {
		if (!chatId) throw new Error('Chat ID is required.')
		return GetUserPersonaName(chatId)
	},
	/**
	 * 获取世界。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.chatId - 聊天ID。
	 * @returns {Promise<string>} - 世界名称。
	 */
	'get-world': ({ chatId }) => {
		if (!chatId) throw new Error('Chat ID is required.')
		return GetWorldName(chatId)
	},
	/**
	 * 获取角色列表。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.chatId - 聊天ID。
	 * @returns {Promise<Array<string>>} - 角色列表。
	 */
	'get-chars': ({ chatId }) => {
		if (!chatId) throw new Error('Chat ID is required.')
		return getCharListOfChat(chatId)
	},
	/**
	 * 设置角色发言频率。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.chatId - 聊天ID。
	 * @param {string} root0.charName - 角色名称。
	 * @param {number} root0.frequency - 频率。
	 * @returns {Promise<void>}
	 */
	'set-char-frequency': ({ chatId, charName, frequency }) => {
		if (!chatId || !charName || !(Object(frequency) instanceof Number)) throw new Error('Chat ID, character name, and frequency are required.')
		return setCharSpeakingFrequency(chatId, charName, frequency)
	},
	/**
	 * 触发角色回复。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.chatId - 聊天ID。
	 * @param {string} root0.charName - 角色名称。
	 * @returns {Promise<void>}
	 */
	'trigger-reply': ({ chatId, charName }) => {
		if (!chatId) throw new Error('Chat ID is required.')
		return triggerCharReply(chatId, charName || null)
	},
	/**
	 * 删除消息。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.chatId - 聊天ID。
	 * @param {number} root0.index - 消息索引。
	 * @returns {Promise<void>}
	 */
	'delete-message': ({ chatId, index }) => {
		if (!chatId || !(Object(index) instanceof Number)) throw new Error('Chat ID and message index are required.')
		return deleteMessage(chatId, index)
	},
	/**
	 * 编辑消息。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.chatId - 聊天ID。
	 * @param {number} root0.index - 消息索引。
	 * @param {object} root0.newContent - 新内容。
	 * @returns {Promise<void>}
	 */
	'edit-message': ({ chatId, index, newContent }) => {
		if (!chatId || !(Object(index) instanceof Number) || !newContent) throw new Error('Chat ID, message index, and new content are required.')
		return editMessage(chatId, index, newContent)
	},
	/**
	 * 修改时间线。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.chatId - 聊天ID。
	 * @param {number} root0.delta - 时间增量。
	 * @returns {Promise<void>}
	 */
	'modify-timeline': ({ chatId, delta }) => {
		if (!chatId || !(Object(delta) instanceof Number)) throw new Error('Chat ID and delta are required.')
		return modifyTimeLine(chatId, delta)
	}
}
