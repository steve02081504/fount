/** @typedef {import('../../../../../decl/charAPI.ts').charAPI_t} charAPI_t */
/** @typedef {import('../../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../decl/UserAPI.ts').UserAPI_t} UserAPI_t */

import { LoadChar } from '../../../../../server/char_manager.mjs'
import { loadPersona } from '../../../../../server/personas_manager.mjs'

/** @type {Record<string, chatMetadata_t>} */
let chatMetadatas = {}
export class timeSlice_t {
	/** @type {charAPI_t[]} */
	chars = []
	/** @type {string} */
	summary
	/** @type {WorldAPI_t} */
	world
	/** @type {UserAPI_t} */
	player
	/** @type {Record<string, any>} */
	chars_memorys = {}
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
	const timeSlice = chatMetadatas[chatid].chatLog[chatMetadatas[chatid].chatLog.length - 1].timeSlice
	timeSlice.player = await loadPersona(username, personaname)
}

export async function setWorld(chatid, worldname) {
	const username = chatMetadatas[chatid].username
	const timeSlice = chatMetadatas[chatid].chatLog[chatMetadatas[chatid].chatLog.length - 1].timeSlice
	timeSlice.world = await loadWorld(username, worldname)
}

export async function addchar(chatid, charname) {
	const username = chatMetadatas[chatid].username
	const timeSlice = chatMetadatas[chatid].chatLog[chatMetadatas[chatid].chatLog.length - 1].timeSlice
	if (timeSlice.chars.some(char => char.name === charname)) return
	timeSlice.chars.push(await LoadChar(username, charname))
}

export function removechar(chatid, charname) {
	const timeSlice = chatMetadatas[chatid].chatLog[chatMetadatas[chatid].chatLog.length - 1].timeSlice
	timeSlice.chars = timeSlice.chars.filter(char => char.name !== charname)
}

function addChatLogEntry(chatid, entry) {
	chatMetadatas[chatid].chatLog.push(entry)
}

export function triggerCharReply(chatid, charname) {
	const timeSlice = chatMetadatas[chatid].chatLog[chatMetadatas[chatid].chatLog.length - 1].timeSlice
	const char = timeSlice.chars.find(char => char.name === charname)
	if (!char) throw new Error('char not found')
	const new_timeSlice = timeSlice.deepCopy()
	let result = char.Request(thisShell, 'chat' , {
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
	const timeSlice = chatMetadatas[chatid].chatLog[chatMetadatas[chatid].chatLog.length - 1].timeSlice
	const new_timeSlice = timeSlice.deepCopy()
	let newEntry = new chatLogEntry_t
	newEntry.content = content
	newEntry.timeSlice = new_timeSlice
	newEntry.role = 'user'
	newEntry.timeStamp = Date.now()

	addChatLogEntry(chatid, newEntry)
}
