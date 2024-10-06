/** @typedef {import('../../../../../decl/charAPI.ts').charAPI_t} charAPI_t */
/** @typedef {import('../../../../../decl/WorldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../decl/UserAPI.ts').UserAPI_t} UserAPI_t */

import { getUserDictionary } from '../../../../../server/auth.mjs'
import { LoadChar } from '../../../../../server/char_manager.mjs'
import { loadJsonFile, saveJsonFile } from '../../../../../server/json_loader.mjs'
import { on_shutdown } from '../../../../../server/on_shutdown.mjs'
import { loadPersona } from '../../../../../server/personas_manager.mjs'
import fs from 'fs'

/** @type {Record<string, chatMetadata_t>} */
let chatMetadatas = {}
export class timeSlice_t {
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
	chars_memorys = {}

	copy() {
		let new_timeSlice = new timeSlice_t
		new_timeSlice.chars = this.chars
		new_timeSlice.summary = this.summary
		new_timeSlice.world = this.world
		new_timeSlice.player = this.player
		new_timeSlice.chars_memorys = JSON.parse(JSON.stringify(this.chars_memorys))
		return new_timeSlice
	}
	toJSON() {
		return {
			chars: Object.keys(this.chars),
			summary: this.summary,
			world: this.world_id,
			player: this.player_id,
			chars_memorys: this.chars_memorys
		}
	}
	static async fromJSON(json, username) {
		let new_timeSlice = new timeSlice_t
		new_timeSlice.chars = {}
		for (const charname of json.chars)
			new_timeSlice.chars[charname] = await LoadChar(username, charname)
		new_timeSlice.summary = json.summary
		if (json.world) {
			new_timeSlice.world_id = json.world
			new_timeSlice.world = await loadWorld(username, json.world)
		}
		if (json.player) {
			new_timeSlice.player_id = json.player
			new_timeSlice.player = await loadPersona(username, json.player)
		}
		new_timeSlice.chars_memorys = json.chars_memorys
		return new_timeSlice
	}
}
export class chatLogEntry_t {
	charName
	avatar
	timeStamp
	role
	content
	timeSlice = new timeSlice_t()
	extension = {
	}

	toJSON() {
		return {
			charName: this.charName,
			avatar: this.avatar,
			timeStamp: this.timeStamp,
			role: this.role,
			content: this.content,
			timeSlice: this.timeSlice.toJSON(),
			extension: this.extension
		}
	}

	static async fromJSON(json, username) {
		let newEntry = new chatLogEntry_t
		newEntry.charName = json.charName
		newEntry.avatar = json.avatar
		newEntry.timeStamp = json.timeStamp
		newEntry.role = json.role
		newEntry.content = json.content
		newEntry.timeSlice = await timeSlice_t.fromJSON(json.timeSlice, username)
		newEntry.extension = json.extension
		return newEntry
	}
}
class chatMetadata_t {
	username
	/** @type {chatLogEntry_t[]} */
	chatLog = []
	timeLines = []
	LastTimeSlice = new timeSlice_t()

	constructor(username) {
		this.username = username
	}

	toJSON() {
		return {
			username: this.username,
			chatLog: this.chatLog.map((log) => log.toJSON()),
			timeLines: this.timeLines
		}
	}

	static async fromJSON(json) {
		let newMetadata = new chatMetadata_t
		newMetadata.username = json.username
		newMetadata.chatLog = []
		for (let data of json.chatLog)
			newMetadata.chatLog.push(await chatLogEntry_t.fromJSON(data, json.username))
		newMetadata.timeLines = json.timeLines
		if (newMetadata.chatLog.length)
			newMetadata.LastTimeSlice = newMetadata.chatLog[newMetadata.chatLog.length - 1].timeSlice
		return newMetadata
	}
}
export function newMetadata(chatid, username) {
	chatMetadatas[chatid] = new chatMetadata_t(username)
}
export function findEmptyChatid() {
	do {
		let uuid = Math.random().toString(36).substring(2, 15)
		if (!chatMetadatas[uuid]) return uuid
	}
	while (true)
}
export function saveChat(chatid, username) {
	fs.mkdirSync(getUserDictionary(username) + '/shells/chat/chats', { recursive: true })
	saveJsonFile(getUserDictionary(username) + '/shells/chat/chats/' + chatid + '.json', chatMetadatas[chatid])
}
export async function loadChat(chatid, username) {
	return chatMetadatas[chatid] = await chatMetadata_t.fromJSON(
		loadJsonFile(getUserDictionary(username) + '/shells/chat/chats/' + chatid + '.json')
	)
}
on_shutdown(() => {
	Object.keys(chatMetadatas).forEach(chatid => saveChat(chatid, chatMetadatas[chatid].username))
})

export async function loadMetaData(chatid, username) {
	if (!chatMetadatas[chatid]) await loadChat(chatid, username)
	return chatMetadatas[chatid]
}

export async function setPersona(chatid, personaname) {
	const username = chatMetadatas[chatid].username
	const timeSlice = chatMetadatas[chatid].LastTimeSlice
	timeSlice.player = await loadPersona(username, personaname)
	timeSlice.player_id = personaname
}

export async function setWorld(chatid, worldname) {
	const username = chatMetadatas[chatid].username
	const timeSlice = chatMetadatas[chatid].LastTimeSlice
	timeSlice.world = await loadWorld(username, worldname)
	timeSlice.world_id = worldname
}

export async function addchar(chatid, charname) {
	const username = chatMetadatas[chatid].username
	const timeSlice = chatMetadatas[chatid].LastTimeSlice
	if (timeSlice.chars[charname]) return
	const char = timeSlice.chars[charname] = await LoadChar(username, charname)
	// GetGreetings
	const greetings = (() => {
		if (chatMetadatas[chatid].chatLog.length === 0)
			return char.interfacies.chat.GetGreetings({
				world: timeSlice.world,
				user: timeSlice.player,
			})
		else
			return char.interfacies.chat.GetGroupGreetings({
				world: timeSlice.world,
				user: timeSlice.player,
				chatLog: chatMetadatas[chatid].chatLog,
			})
	})()

	return addChatLogEntry(chatid, BuildChatLogEntryFromCharReply(greetings[0], timeSlice, char, charname))
}

export function removechar(chatid, charname) {
	const timeSlice = chatMetadatas[chatid].LastTimeSlice
	delete timeSlice.chars[charname]
}

export function getCharListOfChat(chatid) {
	return Object.keys(chatMetadatas[chatid].LastTimeSlice.chars)
}

export function GetChatLog(chatid) {
	return chatMetadatas[chatid].chatLog
}

export function GetUserPersonaName(chatid) {
	return chatMetadatas[chatid].LastTimeSlice.player_id
}

export function GetWorldName(chatid) {
	return chatMetadatas[chatid].LastTimeSlice.world_id
}

function addChatLogEntry(chatid, entry) {
	chatMetadatas[chatid].chatLog.push(entry)
	chatMetadatas[chatid].LastTimeSlice = entry.timeSlice

	return entry
}

function BuildChatLogEntryFromCharReply(result, new_timeSlice, char, charname) {
	let newEntry = new chatLogEntry_t
	newEntry.charName = result.name || char.name || charname
	newEntry.avatar = result.avatar || char.avatar
	newEntry.content = result.content
	newEntry.timeSlice = new_timeSlice
	newEntry.role = 'char'
	newEntry.timeStamp = Date.now()
	newEntry.extension = result.extension

	return newEntry
}

function BuildChatLogEntryFromUserMessage(content, new_timeSlice, user, username) {
	let newEntry = new chatLogEntry_t
	newEntry.charName = user?.name || new_timeSlice.player_id || username
	newEntry.avatar = user?.avatar
	newEntry.content = content
	newEntry.timeSlice = new_timeSlice
	newEntry.role = 'user'
	newEntry.timeStamp = Date.now()

	return newEntry
}

export async function triggerCharReply(chatid, charname) {
	const timeSlice = chatMetadatas[chatid].LastTimeSlice
	const char = timeSlice.chars[charname]
	if (!char) throw new Error('char not found')
	const new_timeSlice = timeSlice.copy()
	let result = await char.interfacies.chat.GetReply({
		chat_log: chatMetadatas[chatid].chatLog,
		world: timeSlice.world,
		user: timeSlice.player,
		chat_summary: timeSlice.summary,
		chat_scoped_char_memory: new_timeSlice.chars_memorys[charname]
	})

	return addChatLogEntry(chatid, BuildChatLogEntryFromCharReply(result, new_timeSlice, char, charname))
}

export function addUserReply(chatid, content) {
	const timeSlice = chatMetadatas[chatid].LastTimeSlice
	const new_timeSlice = timeSlice.copy()
	const user = timeSlice.player

	return addChatLogEntry(chatid, BuildChatLogEntryFromUserMessage(content, new_timeSlice, user, chatMetadatas[chatid].username))
}
