/** @typedef {import('../../../../../decl/charAPI.ts').charAPI_t} charAPI_t */
/** @typedef {import('../../../../../decl/WorldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../decl/UserAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../decl/basedefs.ts').locale_t} locale_t */

import { getUserByUsername, getUserDictionary, getAllUserNames } from '../../../../../server/auth.mjs'
import { LoadChar } from '../../../../../server/managers/char_manager.mjs'
import { loadJsonFile, saveJsonFile } from '../../../../../scripts/json_loader.mjs'
import { getPartInfo } from '../../../../../scripts/locale.mjs'
import { loadPersona } from '../../../../../server/managers/personas_manager.mjs'
import { loadWorld } from '../../../../../server/managers/world_manager.mjs'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'

/**
 * Structure of the chat metadata map:
 * {
 *   [chatId: string]: {
 *     username: string,
 *     chatMetadata: chatMetadata_t
 *   }
 * }
 * @type {Map<string, { username: string, chatMetadata: chatMetadata_t }>}
 */
const chatMetadatas = new Map()

// Initialize chatMetadatas with placeholders for existing chat IDs
function initializeChatMetadatas() {
	const users = getAllUserNames()
	for (const user of users) {
		const userDir = getUserDictionary(user) + '/shells/chat/chats/'
		if (fs.existsSync(userDir)) {
			const chatFiles = fs.readdirSync(userDir).filter(file => file.endsWith('.json'))
			for (const file of chatFiles) {
				const chatid = file.replace('.json', '')
				if (!chatMetadatas.has(chatid))
					chatMetadatas.set(chatid, { username: user, chatMetadata: null })
			}
		}
	}
}

initializeChatMetadatas()

class timeSlice_t {
	/** @type {Record<string, charAPI_t>} */
	chars = {}
	/** @type {WorldAPI_t} */
	world
	/** @type {string} */
	world_id
	/** @type {UserAPI_t} */
	player
	/** @type {string} */
	player_id
	/** @type {Record<string, any>} */
	chars_memories = {}
	/** @type {Record<string, number>} */
	chars_speaking_frequency = {}

	charname
	playername
	greeting_type

	copy() {
		return Object.assign(new timeSlice_t(), this, {
			charname: undefined,
			playername: undefined,
			greeting_type: undefined,
			chars_memories: structuredClone(this.chars_memories)
		})
	}

	toJSON() {
		return {
			chars: Object.keys(this.chars),
			world: this.world_id,
			player: this.player_id,
			chars_memories: this.chars_memories,
			charname: this.charname
		}
	}

	static async fromJSON(json, username) {
		const chars = {}
		for (const charname of json.chars)
			chars[charname] = await LoadChar(username, charname).catch(() => { })

		return Object.assign(new timeSlice_t(), {
			...json,
			chars,
			world_id: json.world,
			world: json.world ? await loadWorld(username, json.world).catch(() => { }) : undefined,
			player_id: json.player,
			player: json.player ? await loadPersona(username, json.player).catch(() => { }) : undefined,
		})
	}
}

class chatLogEntry_t {
	name
	avatar
	timeStamp
	role
	content
	content_for_show
	content_for_edit
	timeSlice = new timeSlice_t()
	files = []
	extension = {}

	toJSON() {
		return {
			...this,
			timeSlice: this.timeSlice.toJSON(),
			files: this.files.map((file) => ({
				...file,
				buffer: file.buffer.toString('base64')
			}))
		}
	}

	static async fromJSON(json, username) {
		return Object.assign(new chatLogEntry_t(), {
			...json,
			timeSlice: await timeSlice_t.fromJSON(json.timeSlice, username),
			files: json.files.map((file) => ({
				...file,
				buffer: Buffer.from(file.buffer, 'base64')
			}))
		})
	}
}

class chatMetadata_t {
	username
	/** @type {chatLogEntry_t[]} */
	chatLog = []
	/** @type {chatLogEntry_t[]} */
	timeLines = []
	/** @type {number} */
	timeLineIndex = 0
	/** @type {timeSlice_t} */
	LastTimeSlice = new timeSlice_t()

	constructor(username) {
		this.username = username
	}

	static async StartNewAs(username) {
		const metadata = new chatMetadata_t(username)

		const user = getUserByUsername(username)
		metadata.LastTimeSlice.player_id = user.defaultParts?.persona
		if (metadata.LastTimeSlice.player_id)
			metadata.LastTimeSlice.player = await loadPersona(username, metadata.LastTimeSlice.player_id)

		metadata.LastTimeSlice.world_id = user.defaultParts?.world
		if (metadata.LastTimeSlice.world_id)
			metadata.LastTimeSlice.world = await loadWorld(username, metadata.LastTimeSlice.world_id)

		return metadata
	}

	toJSON() {
		return {
			username: this.username,
			chatLog: this.chatLog.map((log) => log.toJSON()),
			timeLines: this.timeLines.map(entry => entry.toJSON()),
			timeLineIndex: this.timeLineIndex,
		}
	}

	static async fromJSON(json) {
		const chatLog = await Promise.all(json.chatLog.map(data => chatLogEntry_t.fromJSON(data, json.username)))
		const timeLines = await Promise.all(json.timeLines.map(entry => chatLogEntry_t.fromJSON(entry, json.username)))

		return Object.assign(new chatMetadata_t(), {
			username: json.username,
			chatLog,
			timeLines,
			timeLineIndex: json.timeLineIndex ?? 0,
			LastTimeSlice: chatLog.length ? chatLog[chatLog.length - 1].timeSlice : new timeSlice_t()
		})
	}

	copy() {
		return chatMetadata_t.fromJSON(this.toJSON())
	}
}

export async function newMetadata(chatid, username) {
	chatMetadatas.set(chatid, { username, chatMetadata: await chatMetadata_t.StartNewAs(username) })
}

export function findEmptyChatid() {
	while (true) {
		const uuid = Math.random().toString(36).substring(2, 15)
		if (!chatMetadatas.has(uuid)) return uuid
	}
}

export async function newChat(username) {
	const chatid = findEmptyChatid()
	await newMetadata(chatid, username)
	return chatid
}

export async function saveChat(chatid) {
	const chatData = chatMetadatas.get(chatid)
	if (!chatData || !chatData.chatMetadata) return

	const { username, chatMetadata } = chatData
	fs.mkdirSync(getUserDictionary(username) + '/shells/chat/chats', { recursive: true })
	saveJsonFile(getUserDictionary(username) + '/shells/chat/chats/' + chatid + '.json', chatMetadata)
}

export async function loadChat(chatid) {
	const chatData = chatMetadatas.get(chatid)
	if (!chatData) return undefined

	if (!chatData.chatMetadata) {
		const { username } = chatData
		const filepath = getUserDictionary(username) + '/shells/chat/chats/' + chatid + '.json'
		if (!fs.existsSync(filepath)) return undefined
		chatData.chatMetadata = await chatMetadata_t.fromJSON(loadJsonFile(filepath))
		chatMetadatas.set(chatid, chatData)
	}
	return chatData.chatMetadata
}

/**
 * @param {chatMetadata_t} chatMetadata
 */
function is_VividChat(chatMetadata) {
	return chatMetadata?.chatLog?.filter?.(entry => !entry.timeSlice?.greeting_type)?.length
}

async function getChatRequest(chatid, charname) {
	const chatMetadata = await loadChat(chatid)
	if (!chatMetadata) throw new Error('Chat not found')

	const { username, LastTimeSlice: timeSlice } = chatMetadata
	const { locales } = getUserByUsername(username)
	const userinfo = getPartInfo(timeSlice.player, locales) || {}
	const charinfo = getPartInfo(timeSlice.chars[charname], locales) || {}
	const UserCharname = userinfo.name || timeSlice.player_id || username

	const other_chars = { ...timeSlice.chars }
	delete other_chars[charname]

	/** @type {import('../../decl/chatLog.ts').chatReplyRequest_t} */
	const result = {
		supported_functions: {
			markdown: true,
			mathjax: true,
			html: true,
			unsafe_html: true,
			files: true,
			add_message: true,
		},
		chat_name: 'common_chat_' + chatid,
		chat_id: chatid,
		char_id: charname,
		username,
		UserCharname,
		Charname: charinfo.name || charname,
		locale: locales[0], // TODO: remove
		locales,
		chat_log: chatMetadata.chatLog,
		Update: () => getChatRequest(chatid, charname),
		AddChatLogEntry: (entry) => {
			if (!chatMetadata.LastTimeSlice.chars[charname]) throw new Error('Char not in this chat')
			return addChatLogEntry(chatid, BuildChatLogEntryFromCharReply(
				entry,
				chatMetadata.LastTimeSlice.copy(),
				chatMetadata.LastTimeSlice.chars[charname],
				charname,
				chatMetadata.username
			))
		},
		world: timeSlice.world,
		char: timeSlice.chars[charname],
		user: timeSlice.player,
		other_chars,
		chat_scoped_char_memory: timeSlice.chars_memories[charname] ??= {},
		plugins: [],
		extension: {}
	}

	if (timeSlice.world?.interfaces?.chat?.GetChatLogForCharname)
		result.chat_log = await timeSlice.world.interfaces.chat.GetChatLogForCharname(result, charname)

	return result
}

export async function setPersona(chatid, personaname) {
	const chatMetadata = await loadChat(chatid)
	const { LastTimeSlice: timeSlice, username } = chatMetadata
	if (!personaname) {
		timeSlice.player = undefined
		timeSlice.player_id = undefined
		if (is_VividChat(chatMetadata)) saveChat(chatid)
		return
	}
	timeSlice.player = await loadPersona(username, personaname)
	timeSlice.player_id = personaname

	if (is_VividChat(chatMetadata)) saveChat(chatid)
}

export async function setWorld(chatid, worldname) {
	const chatMetadata = await loadChat(chatid)
	if (!worldname) {
		chatMetadata.LastTimeSlice.world = undefined
		chatMetadata.LastTimeSlice.world_id = undefined
		if (is_VividChat(chatMetadata)) saveChat(chatid)
		return null
	}
	const { username, chatLog } = chatMetadata
	const timeSlice = chatMetadata.LastTimeSlice.copy()
	const world = timeSlice.world = await loadWorld(username, worldname)
	timeSlice.world_id = worldname
	if (world.interfaces.chat.GetGreeting && chatLog.length === 0)
		timeSlice.greeting_type = 'world_single'
	else if (world.interfaces.chat.GetGroupGreeting && chatLog.length > 0)
		timeSlice.greeting_type = 'world_group'

	try {
		const request = await getChatRequest(chatid, undefined)
		let result
		switch (timeSlice.greeting_type) {
			case 'world_single':
				result = await world.interfaces.chat.GetGreeting(request, 0)
				break
			case 'world_group':
				result = await world.interfaces.chat.GetGroupGreeting(request, 0)
				break
		}
		if (!result) return
		const greeting_entrie = BuildChatLogEntryFromCharReply(result, timeSlice, null, undefined, username)
		await addChatLogEntry(chatid, greeting_entrie) // saved, no need for another call
		return greeting_entrie
	} catch (error) {
		chatMetadata.LastTimeSlice.world = timeSlice.world
		chatMetadata.LastTimeSlice.world_id = timeSlice.world_id
	}

	if (is_VividChat(chatMetadata)) saveChat(chatid)
	return null
}

export async function addchar(chatid, charname) {
	const chatMetadata = await loadChat(chatid)
	if (!chatMetadata) throw new Error('Chat not found')

	const { username, chatLog } = chatMetadata
	const timeSlice = chatMetadata.LastTimeSlice.copy()
	if (chatLog.length > 0)
		timeSlice.greeting_type = 'group'
	else
		timeSlice.greeting_type = 'single'

	if (timeSlice.chars[charname]) return

	const char = timeSlice.chars[charname] = await LoadChar(username, charname)

	// Get Greetings
	const request = await getChatRequest(chatid, charname)

	try {
		let result
		switch (timeSlice.greeting_type) {
			case 'single':
				result = await char.interfaces.chat.GetGreeting(request, 0)
				break
			case 'group':
				result = await char.interfaces.chat.GetGroupGreeting(request, 0)
				break
		}
		if (!result) return
		const greeting_entrie = BuildChatLogEntryFromCharReply(result, timeSlice, char, charname, username)
		await addChatLogEntry(chatid, greeting_entrie) // saved, no need for another call
		return greeting_entrie
	} catch (error) {
		console.error(error)
		chatMetadata.LastTimeSlice.chars[charname] = timeSlice.chars[charname]
	}
	if (is_VividChat(chatMetadata)) saveChat(chatid)
	return null
}

export async function removechar(chatid, charname) {
	const chatMetadata = await loadChat(chatid)
	delete chatMetadata.LastTimeSlice.chars[charname]
	if (is_VividChat(chatMetadata)) saveChat(chatid)
}

export async function setCharSpeakingFrequency(chatid, charname, frequency) {
	const chatMetadata = await loadChat(chatid)
	chatMetadata.LastTimeSlice.chars_speaking_frequency[charname] = frequency
	if (is_VividChat(chatMetadata)) saveChat(chatid)
}

export async function getCharListOfChat(chatid) {
	const chatMetadata = await loadChat(chatid)
	return Object.keys(chatMetadata.LastTimeSlice.chars)
}

/**
 * 获取聊天记录
 * @param {string} chatid 聊天 ID
 * @param {number} start 起始索引
 * @param {number} end 结束索引
 * @returns {Promise<Array>} 聊天记录数组
 */
export async function GetChatLog(chatid, start, end) {
	const chatMetadata = await loadChat(chatid)
	return chatMetadata.chatLog.slice(start, end)
}

/**
 * 获取聊天记录长度
 * @param {string} chatid 聊天 ID
 * @returns
 */
export async function GetChatLogLength(chatid) {
	const chatMetadata = await loadChat(chatid)
	return chatMetadata.chatLog.length
}

export async function GetUserPersonaName(chatid) {
	const chatMetadata = await loadChat(chatid)
	return chatMetadata.LastTimeSlice.player_id
}

export async function GetWorldName(chatid) {
	const chatMetadata = await loadChat(chatid)
	return chatMetadata.LastTimeSlice.world_id
}

/**
 *
 * @param {string} chatid
 * @param {chatLogEntry_t} entry
 * @returns {Promise<chatLogEntry_t>}
 */
async function addChatLogEntry(chatid, entry) {
	const chatMetadata = await loadChat(chatid)
	if (entry.timeSlice.world?.interfaces?.chat?.AddChatLogEntry)
		await entry.timeSlice.world.interfaces.chat.AddChatLogEntry(await getChatRequest(chatid, undefined), entry)
	else
		chatMetadata.chatLog.push(entry)

	// Update timeLines for the last entry
	chatMetadata.timeLines = [entry]
	chatMetadata.timeLineIndex = 0
	chatMetadata.LastTimeSlice = entry.timeSlice

	if (is_VividChat(chatMetadata)) saveChat(chatid)

	let freq_data = await getCharReplyFrequency(chatid)
	if (entry.timeSlice.world?.interfaces?.chat?.AfterAddChatLogEntry)
		await entry.timeSlice.world.interfaces.chat.AfterAddChatLogEntry(await getChatRequest(chatid, undefined), freq_data)
	else {
		let char = entry.timeSlice.charname ?? null
		; (async () => {
			while (true) {
				freq_data = freq_data.filter(f => f.charname !== char)
				const nextreply = await getNextCharForReply(freq_data)
				if (nextreply) try {
					await triggerCharReply(chatid, nextreply)
					return
				}
					catch (error) {
						console.error(error)
						char = nextreply
					}
				else
					return
			}
		})()
	}

	return entry
}
/**
 * @param {string} chatid
 * @param {number} delta
 */
export async function modifyTimeLine(chatid, delta) {
	const chatMetadata = await loadChat(chatid)

	let newTimeLineIndex = chatMetadata.timeLineIndex + delta
	if (newTimeLineIndex < 0) newTimeLineIndex += chatMetadata.timeLines.length
	if (newTimeLineIndex >= chatMetadata.timeLines.length) {
		const { charname } = chatMetadata.LastTimeSlice
		const poped = chatMetadata.chatLog.pop()
		try {
			chatMetadata.LastTimeSlice = chatMetadata.chatLog[chatMetadata.chatLog.length - 1]?.timeSlice || chatMetadata.LastTimeSlice
			const new_timeSlice = chatMetadata.LastTimeSlice.copy()
			const char = new_timeSlice.chars[charname]
			const { world } = new_timeSlice
			let result
			switch (new_timeSlice.greeting_type = chatMetadata.LastTimeSlice.greeting_type) {
				case 'single':
					result = await char.interfaces.chat.GetGreeting(await getChatRequest(chatid, charname), newTimeLineIndex)
					break
				case 'group':
					result = await char.interfaces.chat.GetGroupGreeting(await getChatRequest(chatid, charname), newTimeLineIndex)
					break
				case 'world_single':
					result = await world.interfaces.chat.GetGreeting(await getChatRequest(chatid, undefined), newTimeLineIndex)
					break
				case 'world_group':
					result = await world.interfaces.chat.GetGroupGreeting(await getChatRequest(chatid, undefined), newTimeLineIndex)
					break
				default:
					result = await char.interfaces.chat.GetReply(await getChatRequest(chatid, charname))
			}
			if (!result) throw new Error('No reply')
			let entry
			if (new_timeSlice.greeting_type?.startsWith?.('world_'))
				entry = BuildChatLogEntryFromCharReply(result, new_timeSlice, null, undefined, chatMetadata.username)
			else
				entry = BuildChatLogEntryFromCharReply(result, new_timeSlice, char, charname, chatMetadata.username)

			if (entry.timeSlice.world.interfaces?.chat?.AddChatLogEntry)
				entry.timeSlice.world.interfaces.chat.AddChatLogEntry(await getChatRequest(chatid, undefined), entry)
			else
				chatMetadata.chatLog.push(entry)

			// Update timeLines for the last entry
			chatMetadata.timeLines.push(entry)
			newTimeLineIndex = chatMetadata.timeLines.length - 1
		}
		catch (e) {
			console.error(e)
			chatMetadata.chatLog.push(poped)
			newTimeLineIndex %= chatMetadata.timeLines.length
		}
	}
	const entry = chatMetadata.timeLines[newTimeLineIndex]
	chatMetadata.timeLineIndex = newTimeLineIndex
	chatMetadata.LastTimeSlice = entry.timeSlice

	if (is_VividChat(chatMetadata)) saveChat(chatid)

	return chatMetadata.chatLog[chatMetadata.chatLog.length - 1] = entry
}

/**
 * @param {{
 *  name: string,
 *  avatar: string,
 *  content: string,
 *  extension: any
 * }} result
 * @param {timeSlice_t} new_timeSlice
 * @param {charAPI_t} char
 * @param {string} charname
 * @returns {chatLogEntry_t}
 */
function BuildChatLogEntryFromCharReply(result, new_timeSlice, char, charname, username) {
	const { locales } = getUserByUsername(username)
	new_timeSlice.charname = charname
	const info = getPartInfo(char, locales) || {}

	return Object.assign(new chatLogEntry_t(), {
		name: result.name || info.name || charname,
		avatar: result.avatar || info.avatar,
		content: result.content,
		content_for_show: result.content_for_show,
		content_for_edit: result.content_for_edit,
		timeSlice: new_timeSlice,
		role: 'char',
		timeStamp: new Date(),
		files: result.files || [],
		extension: result.extension || {},
		logContextBefore: result.logContextBefore,
		logContextAfter: result.logContextAfter
	})
}

/**
 * @param {{
 *  name: string,
 *  avatar: string,
 *  content: string,
 *  extension: any
 * }} result
 * @param {timeSlice_t} new_timeSlice
 * @param {UserAPI_t} user
 * @param {string} username
 * @returns {chatLogEntry_t}
 */
function BuildChatLogEntryFromUserMessage(result, new_timeSlice, user, username) {
	const { locales } = getUserByUsername(username)
	new_timeSlice.playername = new_timeSlice.player_id
	const info = getPartInfo(user, locales) || {}

	return Object.assign(new chatLogEntry_t(), {
		name: result.name || info.name || new_timeSlice.player_id || username,
		avatar: result.avatar || info.avatar,
		content: result.content,
		timeSlice: new_timeSlice,
		role: 'user',
		timeStamp: new Date(),
		files: result.files || [],
		extension: result.extension || {}
	})
}

async function getCharReplyFrequency(chatid) {
	const chatMetadata = await loadChat(chatid)
	if (!chatMetadata) throw new Error('Chat not found')
	const result = [
		{
			charname: null, // user
			frequency: 1
		}
	]

	for (const charname in chatMetadata.LastTimeSlice.chars) {
		const char = chatMetadata.LastTimeSlice.chars[charname]
		const charbase = await char.interfaces?.chat?.GetReplyFrequency?.(await getChatRequest(chatid, charname)) || 1
		const userbase = chatMetadata.LastTimeSlice.chars_speaking_frequency[charname] || 1
		result.push({
			charname,
			frequency: charbase * userbase
		})
	}

	return result
}

async function getNextCharForReply(frequency_data) {
	const all_freq = frequency_data.map((x) => x.frequency).reduce((a, b) => a + b, 0)
	let random = Math.random() * all_freq

	for (const { charname, frequency } of frequency_data)
		if (random < frequency) return charname
		else random -= frequency
}

export async function triggerCharReply(chatid, charname) {
	const chatMetadata = await loadChat(chatid)
	if (!chatMetadata) throw new Error('Chat not found')

	const timeSlice = chatMetadata.LastTimeSlice
	let result
	if (!charname) {
		const frequency_data = (await getCharReplyFrequency(chatid)).filter(x => x.charname !== null) // 过滤掉用户
		charname = await getNextCharForReply(frequency_data)
		if (!charname) return
	}
	const char = timeSlice.chars[charname]
	if (!char) throw new Error('char not found')

	const request = await getChatRequest(chatid, charname)

	if (timeSlice?.world?.interfaces?.chat?.GetCharReply)
		result = await timeSlice.world.interfaces.chat.GetCharReply(request, charname)
	else
		result = await char.interfaces.chat.GetReply(request)

	if (!result) return
	const new_timeSlice = timeSlice.copy()

	return addChatLogEntry(chatid, BuildChatLogEntryFromCharReply(result, new_timeSlice, char, charname, chatMetadata.username))
}

export async function addUserReply(chatid, object) {
	const chatMetadata = await loadChat(chatid)
	if (!chatMetadata) throw new Error('Chat not found')

	const timeSlice = chatMetadata.LastTimeSlice
	const new_timeSlice = timeSlice.copy()
	const user = timeSlice.player

	return addChatLogEntry(chatid, BuildChatLogEntryFromUserMessage(object, new_timeSlice, user, chatMetadata.username))
}

export async function getChatList(username) {
	const userDir = getUserDictionary(username) + '/shells/chat/chats/'
	if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true })
	const chatFiles = fs.readdirSync(userDir).filter(file => file.endsWith('.json'))

	for (const file of chatFiles)
		await loadChat(file.replace('.json', ''), username)

	return [...chatMetadatas.entries()].filter(([id, { username: name }]) => name === username).map(([chatid, { chatMetadata }]) => {
		if (is_VividChat(chatMetadata)) {
			const lastEntry = chatMetadata.chatLog[chatMetadata.chatLog.length - 1]
			return {
				chatid,
				chars: Object.keys(chatMetadata.LastTimeSlice.chars),
				lastMessageSender: lastEntry.name,
				lastMessageSenderAvatar: lastEntry.avatar || null,
				lastMessageContent: lastEntry.content,
				lastMessageTime: lastEntry.timeStamp,
			}
		}
	}).filter(Boolean)
}

export async function deleteChat(chatids, username) {
	const basedir = getUserDictionary(username) + '/shells/chat/chats/'
	const deletePromises = chatids.map(async (chatid) => {
		try {
			if (fs.existsSync(basedir + chatid + '.json')) await fs.promises.unlink(basedir + chatid + '.json')
			chatMetadatas.delete(chatid)
			return { chatid, success: true, message: 'Chat deleted successfully' }
		} catch (error) {
			console.error(`Error deleting chat ${chatid}:`, error)
			return { chatid, success: false, message: 'Error deleting chat', error: error.message }
		}
	})

	return Promise.all(deletePromises)
}

export async function copyChat(chatids, username) {
	const copyPromises = chatids.map(async (chatid) => {
		const originalChat = await loadChat(chatid)
		if (!originalChat)
			return { chatid, success: false, message: 'Original chat not found' }

		const newChatId = await newChat(username)
		const copiedChat = await originalChat.copy()
		chatMetadatas.set(newChatId, { username, chatMetadata: copiedChat })
		chatMetadatas.get(newChatId).chatMetadata.LastTimeSlice = copiedChat.chatLog[copiedChat.chatLog.length - 1].timeSlice
		await saveChat(newChatId)
		return { chatid, success: true, newChatId, message: 'Chat copied successfully' }
	})
	return Promise.all(copyPromises)
}

export async function exportChat(chatids) {
	const exportPromises = chatids.map(async (chatid) => {
		try {
			const chat = await loadChat(chatid)
			if (!chat) return { chatid, success: false, message: 'Chat not found', error: 'Chat not found' }
			return { chatid, success: true, data: chat }
		} catch (error) {
			console.error(`Error exporting chat ${chatid}:`, error)
			return { chatid, success: false, message: 'Error exporting chat', error: error.message }
		}
	})

	return Promise.all(exportPromises)
}

/**
 * Deletes a specific chat log entry from a chat.
 *
 * @param {string} chatid The ID of the chat.
 * @param {number} index The index of the chat log entry to delete.
 * @returns {Promise<{ success: boolean, message: string, error?: string }>}  An object indicating success or failure.
 */
export async function deleteMessage(chatid, index) {
	const chatMetadata = await loadChat(chatid)
	if (!chatMetadata) throw new Error('Chat not found')
	if (index < 0 || index >= chatMetadata.chatLog.length) throw new Error('Invalid index')

	function geneRequest() {
		return {
			index,
			chat_log: chatMetadata.chatLog,
			chat_entry: chatMetadata.chatLog[index],
		}
	}
	// 若有world,让world处理消息删除
	if (chatMetadata.LastTimeSlice.world?.interfaces?.chat?.MessageDelete)
		await chatMetadata.LastTimeSlice.world.interfaces.chat.MessageDelete(geneRequest())
	else {
		// 通知每个char消息将被删除
		for (const char of Object.values(chatMetadata.LastTimeSlice.chars))
			await char.interfaces.chat?.MessageDelete?.(geneRequest())
		// 还有user
		await chatMetadata.LastTimeSlice.player?.interfaces?.chat?.MessageDelete?.(geneRequest())
		chatMetadata.chatLog.splice(index, 1)
	}

	const last = chatMetadata.chatLog[chatMetadata.chatLog.length - 1]

	if (index == chatMetadata.chatLog.length) {
		chatMetadata.timeLines = [last]
		chatMetadata.timeLineIndex = 0
	}

	if (chatMetadata.chatLog.length > 0)
		chatMetadata.LastTimeSlice = last.timeSlice
	else
		chatMetadata.LastTimeSlice = new timeSlice_t()

	if (is_VividChat(chatMetadata)) saveChat(chatid)
}

export async function editMessage(chatid, index, new_content) {
	const chatMetadata = await loadChat(chatid)
	if (!chatMetadata) throw new Error('Chat not found')
	if (index < 0 || index >= chatMetadata.chatLog.length) throw new Error('Invalid index')

	function geneRequest() {
		return {
			index,
			original: chatMetadata.chatLog[index],
			edited: new_content,
			chat_log: chatMetadata.chatLog,
		}
	}
	// 若有world,让world处理消息编辑
	let editresult
	if (chatMetadata.LastTimeSlice.world?.interfaces?.chat?.MessageEdit)
		editresult = await chatMetadata.LastTimeSlice.world.interfaces.chat.MessageEdit(geneRequest())
	else {
		// 通知消息原作者处理消息编辑
		const entry = chatMetadata.chatLog[index]
		if (entry.timeSlice.charname) {
			const char = entry.timeSlice.chars[entry.timeSlice.charname]
			editresult = await char.interfaces.chat?.MessageEdit?.(geneRequest())
		}
		else if (entry.timeSlice.playername)
			editresult = await entry.timeSlice?.player?.interfaces?.chat?.MessageEdit?.(geneRequest())
		editresult ??= new_content

		// 通知其他人消息被编辑
		if (chatMetadata.LastTimeSlice.world?.interfaces?.chat?.MessageEditing)
			await chatMetadata.LastTimeSlice.world.interfaces.chat.MessageEditing(geneRequest())
		else {
			for (const char of Object.values(chatMetadata.LastTimeSlice.chars))
				await char.interfaces?.chat?.MessageEditing?.(geneRequest())

			await chatMetadata.LastTimeSlice.player?.interfaces?.chat?.MessageEditing?.(geneRequest())
		}
	}

	const { timeSlice } = chatMetadata.chatLog[index]
	let entry
	if (timeSlice.charname) {
		const char = timeSlice.chars[timeSlice.charname]
		entry = BuildChatLogEntryFromCharReply(editresult, timeSlice, char, timeSlice.charname, chatMetadata.username)
	}
	else
		entry = BuildChatLogEntryFromUserMessage(editresult, timeSlice, chatMetadata.LastTimeSlice, chatMetadata.username)

	chatMetadata.timeLines[chatMetadata.timeLineIndex] = chatMetadata.chatLog[index] = entry

	if (is_VividChat(chatMetadata)) saveChat(chatid)

	return entry
}

export async function getHeartbeatData(chatid, start) {
	const chatMetadata = await loadChat(chatid)
	const timeSlice = chatMetadata.LastTimeSlice
	return {
		charlist: Object.keys(timeSlice.chars),
		worldname: timeSlice.world_id,
		personaname: timeSlice.player_id,
		frequency_data: timeSlice.chars_speaking_frequency,
		Messages: chatMetadata.chatLog.slice(start)
	}
}

