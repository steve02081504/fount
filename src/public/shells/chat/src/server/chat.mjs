/** @typedef {import('../../../../../decl/charAPI.ts').charAPI_t} charAPI_t */
/** @typedef {import('../../../../../decl/WorldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../decl/UserAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../decl/basedefs.ts').locale_t} locale_t */

import { getUserDictionary } from '../../../../../server/auth.mjs'
import { LoadChar } from '../../../../../server/char_manager.mjs'
import { loadJsonFile, saveJsonFile } from '../../../../../server/json_loader.mjs'
import { on_shutdown } from '../../../../../server/on_shutdown.mjs'
import { getPartInfo } from '../../../../../server/parts_loader.mjs'
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
	name
	avatar
	timeStamp
	role
	content
	timeSlice = new timeSlice_t()
	extension = {
	}

	toJSON() {
		return {
			name: this.name,
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
		newEntry.name = json.name
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


function getChatRequest(chatid, charname, locale, timeSlice = chatMetadatas[chatid].LastTimeSlice) {
	const char = timeSlice.chars[charname]
	const username = chatMetadatas[chatid].username
	const userinfo = getPartInfo(timeSlice.player, locale)
	const charinfo = getPartInfo(char, locale)
	if (!char) throw new Error('char not found')
	return {
		username: username,
		UserCharname: userinfo?.name || timeSlice.player_id || username,
		Charname: charinfo?.name || charname,
		chatid: chatid,
		chat_log: chatMetadatas[chatid].chatLog,
		world: timeSlice.world,
		char: char,
		user: timeSlice.player,
		other_chars: Object.keys(timeSlice.chars).filter((name) => name !== charname).map((charname) => timeSlice.chars[charname]),
		chat_summary: timeSlice.summary,
		chat_scoped_char_memory: timeSlice.chars_memorys[charname],
		plugins: []
	}
}

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

export async function addchar(chatid, charname, locale) {
	const username = chatMetadatas[chatid].username
	const timeSlice = chatMetadatas[chatid].LastTimeSlice
	if (timeSlice.chars[charname]) return
	const char = timeSlice.chars[charname] = await LoadChar(username, charname)
	// GetGreetings
	const greetings = (() => {
		let request = getChatRequest(chatid, charname, locale, timeSlice)
		if (chatMetadatas[chatid].chatLog.length === 0)
			return char.interfacies.chat.GetGreetings(request)
		else
			return char.interfacies.chat.GetGroupGreetings(request)
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

/**
 * @param {{
 * 	name: string,
 * 	avatar: string,
 * 	content: string,
 * 	extension: any
 * }} result
 * @param {timeSlice_t} new_timeSlice
 * @param {CharAPI_t} char
 * @param {string} charname
 * @param {locale_t} locale
 * @returns {chatLogEntry_t}
 */
function BuildChatLogEntryFromCharReply(result, new_timeSlice, char, charname, locale) {
	let newEntry = new chatLogEntry_t
	let info = getPartInfo(char, locale)
	newEntry.name = result.name || info.name || charname
	newEntry.avatar = result.avatar || info.avatar
	newEntry.content = result.content
	newEntry.timeSlice = new_timeSlice
	newEntry.role = 'char'
	newEntry.timeStamp = Date.now()
	newEntry.extension = result.extension

	return newEntry
}

/**
 * @param {string} content
 * @param {timeSlice_t} new_timeSlice
 * @param {UserAPI_t} user
 * @param {string} username
 * @param {locale_t} locale
 * @returns {chatLogEntry_t}
 */
function BuildChatLogEntryFromUserMessage(content, new_timeSlice, user, username, locale) {
	let newEntry = new chatLogEntry_t
	let info = getPartInfo(user, locale)
	newEntry.name = info?.name || new_timeSlice.player_id || username
	newEntry.avatar = info?.avatar
	newEntry.content = content
	newEntry.timeSlice = new_timeSlice
	newEntry.role = 'user'
	newEntry.timeStamp = Date.now()

	return newEntry
}

export async function triggerCharReply(chatid, charname, locale) {
	const timeSlice = chatMetadatas[chatid].LastTimeSlice
	const char = timeSlice.chars[charname]
	if (!char) throw new Error('char not found')
	const new_timeSlice = timeSlice.copy()
	let result = await char.interfacies.chat.GetReply(getChatRequest(chatid, charname, locale, new_timeSlice))

	return addChatLogEntry(chatid, BuildChatLogEntryFromCharReply(result, new_timeSlice, char, charname, locale))
}

export function addUserReply(chatid, content, locale) {
	const timeSlice = chatMetadatas[chatid].LastTimeSlice
	const new_timeSlice = timeSlice.copy()
	const user = timeSlice.player

	return addChatLogEntry(chatid, BuildChatLogEntryFromUserMessage(content, new_timeSlice, user, chatMetadatas[chatid].username, locale))
}
