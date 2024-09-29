/** @typedef {import('../../../../../decl/charAPI.ts').charAPI_t} charAPI_t */
/** @typedef {import('../../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../decl/UserAPI.ts').UserAPI_t} UserAPI_t */

import { LoadChar } from '../../../../../server/char_manager.mjs'
import { loadPersona } from '../../../../../server/personas_manager.mjs'
import * as thisShell from '../../main.mjs'

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
	timeSlice.chars[charname] = await LoadChar(username, charname)
	console.log(`loading char ${charname} for user ${username} at chat ${chatid}`)
	console.log(timeSlice.chars)
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
}

export function triggerCharReply(chatid, charname) {
	const timeSlice = chatMetadatas[chatid].LastTimeSlice
	const char = timeSlice.chars[charname]
	console.log(timeSlice.chars, charname)
	if (!char) throw new Error('char not found')
	const new_timeSlice = timeSlice.copy()
	let result = char.Request(thisShell, 'chat', {
		EventName: 'reply',
		char_log: chatMetadatas[chatid].chatLog,
		world: timeSlice.world,
		user: timeSlice.player,
		chat_summary: timeSlice.summary,
		chat_scoped_char_memory: new_timeSlice.chars_memorys[charname]
	})
	let newEntry = new chatLogEntry_t
	newEntry.charName = result.name || char.name || charname
	newEntry.avatar = result.avatar || char.avatar
	newEntry.content = result.content
	newEntry.timeSlice = new_timeSlice
	newEntry.role = 'char'
	newEntry.timeStamp = Date.now()
	newEntry.extension = result.extension

	addChatLogEntry(chatid, newEntry)

	return newEntry
}

export function addUserReply(chatid, content) {
	const timeSlice = chatMetadatas[chatid].LastTimeSlice
	const new_timeSlice = timeSlice.copy()
	const user = timeSlice.player
	let newEntry = new chatLogEntry_t
	newEntry.charName = user?.name || timeSlice.player_id || chatMetadatas[chatid].username
	newEntry.avatar = user?.avatar
	newEntry.content = content
	newEntry.timeSlice = new_timeSlice
	newEntry.role = 'user'
	newEntry.timeStamp = Date.now()

	addChatLogEntry(chatid, newEntry)

	return newEntry
}
