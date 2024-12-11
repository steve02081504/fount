/** @typedef {import('../../../../../decl/charAPI.ts').charAPI_t} charAPI_t */
/** @typedef {import('../../../../../decl/WorldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../decl/UserAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../decl/basedefs.ts').locale_t} locale_t */

import { getUserByUsername, getUserDictionary, getAllUserNames } from '../../../../../server/auth.mjs'
import { LoadChar } from '../../../../../server/managers/char_manager.mjs'
import { loadJsonFile, saveJsonFile } from '../../../../../scripts/json_loader.mjs'
import { on_shutdown } from '../../../../../server/on_shutdown.mjs'
import { getPartInfo } from '../../../../../server/parts_loader.mjs'
import { loadPersona } from '../../../../../server/managers/personas_manager.mjs'
import { loadWorld } from "../../../../../server/managers/world_manager.mjs"
import { Buffer } from "node:buffer"
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
let chatMetadatas = new Map()

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
	/** @type {string} */
	summary
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

	charname

	copy() {
		return Object.assign(new timeSlice_t(), this, {
			chars_memories: structuredClone(this.chars_memories)
		})
	}

	toJSON() {
		return {
			chars: Object.keys(this.chars),
			summary: this.summary,
			world: this.world_id,
			player: this.player_id,
			chars_memories: this.chars_memories,
			charname: this.charname
		}
	}

	static async fromJSON(json, username) {
		const chars = {}
		for (const charname of json.chars)
			chars[charname] = await LoadChar(username, charname)

		return Object.assign(new timeSlice_t(), {
			...json,
			chars,
			world_id: json.world,
			world: json.world ? await loadWorld(username, json.world) : undefined,
			player_id: json.player,
			player: json.player ? await loadPersona(username, json.player) : undefined,
		})
	}
}

class chatLogEntry_t {
	name
	avatar
	timeStamp
	role
	content
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
	LastTimeSlice = new timeSlice_t()

	constructor(username) {
		this.username = username
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

export function newMetadata(chatid, username) {
	chatMetadatas.set(chatid, { username, chatMetadata: new chatMetadata_t(username) })
}

export function findEmptyChatid() {
	while (true) {
		let uuid = Math.random().toString(36).substring(2, 15)
		if (!chatMetadatas.has(uuid)) return uuid
	}
}

export function newChat(username) {
	let chatid = findEmptyChatid()
	newMetadata(chatid, username)
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

function is_VividChat(chatMetadata) {
	return chatMetadata && (
		chatMetadata.chatLog.filter(entry => entry.role == 'user').length ||
		chatMetadata.chatLog.length > 1
	)
}
on_shutdown(() => {
	chatMetadatas.forEach(({ chatMetadata }, chatid) => {
		if (is_VividChat(chatMetadata))
			saveChat(chatid)
	})
})

async function getChatRequest(chatid, charname) {
	const chatMetadata = await loadChat(chatid)

	const { username, LastTimeSlice: timeSlice } = chatMetadata
	const { locale } = getUserByUsername(username)
	const userinfo = getPartInfo(timeSlice.player, locale) || {}
	const charinfo = getPartInfo(timeSlice.chars[charname], locale) || {}
	const UserCharname = userinfo.name || timeSlice.player_id || username

	return {
		username,
		UserCharname,
		Charname: charinfo.name || charname,
		chatid,
		locale,
		chat_log: chatMetadata.chatLog,
		world: timeSlice.world,
		char: timeSlice.chars[charname],
		user: timeSlice.player,
		other_chars: Object.values(timeSlice.chars).filter((char) => char.name !== charname),
		chat_summary: timeSlice.summary,
		chat_scoped_char_memory: timeSlice.chars_memories[charname] ??= {},
		plugins: []
	}
}

export async function setPersona(chatid, personaname) {
	const chatMetadata = await loadChat(chatid)
	const { LastTimeSlice: timeSlice, username } = chatMetadata
	timeSlice.player = await loadPersona(username, personaname)
	timeSlice.player_id = personaname
}

export async function setWorld(chatid, worldname) {
	const chatMetadata = await loadChat(chatid)
	const { LastTimeSlice: timeSlice, username } = chatMetadata
	timeSlice.world = await loadWorld(username, worldname)
	timeSlice.world_id = worldname
}

export async function addchar(chatid, charname) {
	const chatMetadata = await loadChat(chatid)

	const { username, LastTimeSlice: timeSlice, chatLog } = chatMetadata
	if (timeSlice.chars[charname]) return

	const char = timeSlice.chars[charname] = await LoadChar(username, charname)

	// Get Greetings
	const request = await getChatRequest(chatid, charname)
	let greetings = await (chatLog.length === 0
		? char.interfacies.chat.GetGreetings
		: char.interfacies.chat.GetGroupGreetings)(request)

	let greeting_entries = greetings.map(greeting => BuildChatLogEntryFromCharReply(greeting, timeSlice, char, charname, username))

	await addChatLogEntry(chatid, greeting_entries[0])
	chatMetadata.timeLines = greeting_entries

	return greetings[0]
}

export async function removechar(chatid, charname) {
	const chatMetadata = await loadChat(chatid)
	delete chatMetadata.LastTimeSlice.chars[charname]
}

export async function getCharListOfChat(chatid) {
	const chatMetadata = await loadChat(chatid)
	return Object.keys(chatMetadata.LastTimeSlice.chars)
}

export async function GetChatLog(chatid) {
	const chatMetadata = await loadChat(chatid)
	return chatMetadata.chatLog
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
 * @returns
 */
async function addChatLogEntry(chatid, entry) {
	const chatMetadata = await loadChat(chatid)
	if (entry.timeSlice.world)
		entry.timeSlice.world.interfacies.chat.AddChatLogEntry(await getChatRequest(chatid, undefined), entry)
	else
		chatMetadata.chatLog.push(entry)

	// Update timeLines for the last entry
	chatMetadata.timeLines = [entry]
	chatMetadata.timeLineIndex = 0
	chatMetadata.LastTimeSlice = entry.timeSlice
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
		const charname = chatMetadata.LastTimeSlice.charname
		let poped = chatMetadata.chatLog.pop()
		try {
			chatMetadata.LastTimeSlice = chatMetadata.chatLog[chatMetadata.chatLog.length - 1].timeSlice
			let new_timeSlice = chatMetadata.LastTimeSlice.copy()
			const char = new_timeSlice.chars[charname]
			const result = await char.interfacies.chat.GetReply(await getChatRequest(chatid, charname))
			const entry = BuildChatLogEntryFromCharReply(result, new_timeSlice, char, charname, chatMetadata.username)

			if (entry.timeSlice.world)
				entry.timeSlice.world.interfacies.chat.AddChatLogEntry(await getChatRequest(chatid, undefined), entry)
			else
				chatMetadata.chatLog.push(entry)

			// Update timeLines for the last entry
			chatMetadata.timeLines.push(entry)
			newTimeLineIndex = chatMetadata.timeLines.length - 1
		}
		catch (e) {
			chatMetadata.chatLog.push(poped)
			newTimeLineIndex %= chatMetadata.timeLines.length
		}
	}
	let entry = chatMetadata.timeLines[newTimeLineIndex]
	chatMetadata.timeLineIndex = newTimeLineIndex
	chatMetadata.LastTimeSlice = entry.timeSlice

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
	const { locale } = getUserByUsername(username)
	new_timeSlice.charname = charname
	const info = getPartInfo(char, locale) || {}

	return Object.assign(new chatLogEntry_t(), {
		name: result.name || info.name || charname,
		avatar: result.avatar || info.avatar,
		content: result.content,
		timeSlice: new_timeSlice,
		role: 'char',
		timeStamp: new Date(),
		extension: result.extension || {},
		logContextBefore: result.logContextBefore,
		logContextAfter: result.logContextAfter
	})
}

/**
 * @param {string} content
 * @param {timeSlice_t} new_timeSlice
 * @param {UserAPI_t} user
 * @param {string} username
 * @returns {chatLogEntry_t}
 */
function BuildChatLogEntryFromUserMessage(content, new_timeSlice, user, username) {
	const { locale } = getUserByUsername(username)
	const info = getPartInfo(user, locale) || {}

	return Object.assign(new chatLogEntry_t(), {
		name: info.name || new_timeSlice.player_id || username,
		avatar: info.avatar,
		content: content,
		timeSlice: new_timeSlice,
		role: 'user',
		timeStamp: new Date()
	})
}

export async function triggerCharReply(chatid, charname) {
	const chatMetadata = await loadChat(chatid)
	if (!chatMetadata) throw new Error('Chat not found')

	const timeSlice = chatMetadata.LastTimeSlice
	const char = timeSlice.chars[charname]
	if (!char) throw new Error('char not found')

	const new_timeSlice = timeSlice.copy()
	const result = await char.interfacies.chat.GetReply(await getChatRequest(chatid, charname))

	return addChatLogEntry(chatid, BuildChatLogEntryFromCharReply(result, new_timeSlice, char, charname, chatMetadata.username))
}

export async function addUserReply(chatid, content) {
	const chatMetadata = await loadChat(chatid)
	if (!chatMetadata) throw new Error('Chat not found')

	const timeSlice = chatMetadata.LastTimeSlice
	const new_timeSlice = timeSlice.copy()
	const user = timeSlice.player

	return addChatLogEntry(chatid, BuildChatLogEntryFromUserMessage(content, new_timeSlice, user, chatMetadata.username))
}

export async function getChatList(username) {
	const userDir = getUserDictionary(username) + '/shells/chat/chats/'
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

		const newChatId = newChat(username)
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
