import {
	loadChat, addchar, newChat, setPersona, setWorld, getChatList, addUserReply, GetChatLog, GetChatLogLength,
	removechar, setCharSpeakingFrequency, getCharListOfChat, GetUserPersonaName, GetWorldName, modifyTimeLine,
	triggerCharReply, deleteMessage, editMessage
} from './chat.mjs'

/**
 * 定义了可用于聊天功能的各种操作。
 */
export const actions = {
	/**
	 * 开始一个新的聊天会话。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @param {string} root0.charName - 要添加到新聊天的角色名称。
	 * @returns {Promise<string>} - 新聊天会话的ID。
	 */
	start: async ({ user, charName }) => {
		const chatId = await newChat(user)
		if (charName) await addchar(chatId, charName)
		return chatId
	},
	/**
	 * 根据提供的JSON信息加载聊天会话。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @param {object} root0.chatInfo - 包含聊天详细信息的JSON对象。
	 * @returns {Promise<string>} - 加载的聊天会话的ID。
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
	 * 加载现有的聊天会话。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.chatId - 要加载的聊天的ID。
	 * @returns {string} - 确认加载的聊天ID。
	 */
	load: ({ chatId }) => {
		if (!chatId) throw new Error('Chat ID is required for load command.')
		return chatId
	},
	/**
	 * 列出指定用户的所有聊天会话。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @returns {Promise<Array<string>>} - 聊天ID的数组。
	 */
	list: ({ user }) => getChatList(user),
	/**
	 * 向指定的聊天会话发送消息。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.chatId - 目标聊天的ID。
	 * @param {object} root0.message - 要发送的消息对象。
	 * @returns {Promise<void>}
	 */
	send: ({ chatId, message }) => {
		if (!chatId || !message) throw new Error('Chat ID and message are required for send command.')
		return addUserReply(chatId, message)
	},
	/**
	 * 获取聊天会话的最后几条消息。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.chatId - 目标聊天的ID。
	 * @param {number} root0.n - 要检索的消息数量。
	 * @returns {Promise<Array<object>>} - 消息对象数组。
	 */
	tail: async ({ chatId, n = 5 }) => {
		if (!chatId) throw new Error('Chat ID is required for tail command.')
		const logLength = await GetChatLogLength(chatId)
		return GetChatLog(chatId, Math.max(0, logLength - n), logLength)
	},
	/**
	 * 从聊天中移除一个角色。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.chatId - 目标聊天的ID。
	 * @param {string} root0.charName - 要移除的角色名称。
	 * @returns {Promise<void>}
	 */
	'remove-char': ({ chatId, charName }) => {
		if (!chatId || !charName) throw new Error('Chat ID and character name are required.')
		return removechar(chatId, charName)
	},
	/**
	 * 为聊天设置用户角色。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.chatId - 目标聊天的ID。
	 * @param {string} root0.personaName - 要设置的角色名称。
	 * @returns {Promise<void>}
	 */
	'set-persona': ({ chatId, personaName }) => {
		if (!chatId) throw new Error('Chat ID is required.')
		return setPersona(chatId, personaName || null)
	},
	/**
	 * 为聊天设置世界观。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.chatId - 目标聊天的ID。
	 * @param {string} root0.worldName - 要设置的世界观名称。
	 * @returns {Promise<void>}
	 */
	'set-world': ({ chatId, worldName }) => {
		if (!chatId) throw new Error('Chat ID is required.')
		return setWorld(chatId, worldName || null)
	},
	/**
	 * 获取当前用户角色。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.chatId - 目标聊天的ID。
	 * @returns {Promise<string>} - 当前用户角色的名称。
	 */
	'get-persona': ({ chatId }) => {
		if (!chatId) throw new Error('Chat ID is required.')
		return GetUserPersonaName(chatId)
	},
	/**
	 * 获取当前世界观。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.chatId - 目标聊天的ID。
	 * @returns {Promise<string>} - 当前世界观的名称。
	 */
	'get-world': ({ chatId }) => {
		if (!chatId) throw new Error('Chat ID is required.')
		return GetWorldName(chatId)
	},
	/**
	 * 获取聊天中的角色列表。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.chatId - 目标聊天的ID。
	 * @returns {Promise<Array<string>>} - 角色名称的数组。
	 */
	'get-chars': ({ chatId }) => {
		if (!chatId) throw new Error('Chat ID is required.')
		return getCharListOfChat(chatId)
	},
	/**
	 * 设置角色的发言频率。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.chatId - 目标聊天的ID。
	 * @param {string} root0.charName - 要设置频率的角色的名称。
	 * @param {number} root0.frequency - 发言频率。
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
	 * 删除指定索引的消息。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.chatId - 目标聊天的ID。
	 * @param {number} root0.index - 要删除的消息的索引。
	 * @returns {Promise<void>}
	 */
	'delete-message': ({ chatId, index }) => {
		if (!chatId || !(Object(index) instanceof Number)) throw new Error('Chat ID and message index are required.')
		return deleteMessage(chatId, index)
	},
	/**
	 * 编辑指定索引的消息。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.chatId - 目标聊天的ID。
	 * @param {number} root0.index - 要编辑的消息的索引。
	 * @param {object} root0.newContent - 消息的新内容。
	 * @returns {Promise<void>}
	 */
	'edit-message': ({ chatId, index, newContent }) => {
		if (!chatId || !(Object(index) instanceof Number) || !newContent) throw new Error('Chat ID, message index, and new content are required.')
		return editMessage(chatId, index, newContent)
	},
	/**
	 * 修改聊天的时间线。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.chatId - 目标聊天的ID。
	 * @param {number} root0.delta - 时间线修改的增量。
	 * @returns {Promise<void>}
	 */
	'modify-timeline': ({ chatId, delta }) => {
		if (!chatId || !(Object(delta) instanceof Number)) throw new Error('Chat ID and delta are required.')
		return modifyTimeLine(chatId, delta)
	}
}
