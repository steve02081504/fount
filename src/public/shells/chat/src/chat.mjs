/** @typedef {import('../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../decl/WorldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../decl/UserAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../decl/basedefs.ts').locale_t} locale_t */

import { Buffer } from 'node:buffer'
import fs from 'node:fs'

import { loadJsonFile, saveJsonFile } from '../../../../scripts/json_loader.mjs'
import { getPartInfo } from '../../../../scripts/locale.mjs'
import { getUserByUsername, getUserDictionary, getAllUserNames } from '../../../../server/auth.mjs'
import { events } from '../../../../server/events.mjs'
import { LoadChar } from '../../../../server/managers/char_manager.mjs'
import { loadPersona } from '../../../../server/managers/persona_manager.mjs'
import { loadWorld } from '../../../../server/managers/world_manager.mjs'
import { getDefaultParts } from '../../../../server/parts_loader.mjs'
import { skip_report } from '../../../../server/server.mjs'
import { sendNotification } from '../../../../server/web_server/notify.mjs'

import { addfile, getfile } from './files.mjs'

/**
 * @description 聊天元数据映射表的结构。这是一个在内存中缓存聊天信息的Map。
 * 键是聊天ID (chatId)，值是一个对象，包含用户名和聊天元数据。
 * `chatMetadata` 属性可能为 `null`，表示该聊天的元数据存在于磁盘上，但尚未被完整加载到内存中。
 * @type {Map<string, { username: string, chatMetadata: chatMetadata_t | null }>}
 */
const chatMetadatas = new Map()
const chatUiSockets = new Map()

export function registerChatUiSocket(chatid, ws) {
	if (!chatUiSockets.has(chatid))
		chatUiSockets.set(chatid, new Set())

	const socketSet = chatUiSockets.get(chatid)
	socketSet.add(ws)
	console.log(`Chat UI WebSocket registered for chat ${chatid}. Total: ${socketSet.size}`)

	ws.on('close', () => {
		socketSet.delete(ws)
		console.log(`Chat UI WebSocket disconnected for chat ${chatid}. Total: ${socketSet.size}`)
		if (!socketSet.size)
			chatUiSockets.delete(chatid)
	})
}

function broadcastChatEvent(chatid, event) {
	const sockets = chatUiSockets.get(chatid)
	if (!sockets?.size) return

	const message = JSON.stringify(event)
	for (const ws of sockets)
		if (ws.readyState === ws.OPEN)
			ws.send(message)
}

/**
 * @description 初始化 chatMetadatas 映射表。
 * 此函数会遍历所有用户的聊天文件目录，为每个已存在的聊天ID在内存中创建一个占位符。
 * 这样做可以避免在需要时重新扫描文件系统，并能快速确定一个聊天ID属于哪个用户。
 * 初始时，`chatMetadata` 值为 `null`，表示完整的聊天数据尚未加载。
 */
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

/**
 * @description 代表聊天中特定时间点的“时间切片”，包含了该时刻的所有上下文状态。
 * 这包括参与的角色、世界、玩家信息以及他们的记忆。
 * 每次消息发送时，都会创建一个新的时间切片或复制前一个，以捕捉状态的变化。
 */
class timeSlice_t {
	/**
	 * @description 当前参与聊天的角色对象映射表。键为角色ID，值为角色API对象。
	 * @type {Record<string, CharAPI_t>}
	 */
	chars = {}
	/**
	 * @description 当前聊天所在的世界API对象。
	 * @type {WorldAPI_t}
	 */
	world
	/**
	 * @description 当前世界的文件名/ID。
	 * @type {string}
	 */
	world_id
	/**
	 * @description 代表玩家的“人格”API对象。
	 * @type {UserAPI_t}
	 */
	player
	/**
	 * @description 当前玩家“人格”的文件名/ID。
	 * @type {string}
	 */
	player_id
	/**
	 * @description 存储每个角色在当前聊天中的特定记忆。键为角色ID，值为该角色的记忆对象。
	 * @type {Record<string, any>}
	 */
	chars_memories = {}
	/**
	 * @description 存储用户为每个角色设置的发言频率。键为角色ID，值为频率乘数。
	 * @type {Record<string, number>}
	 */
	chars_speaking_frequency = {}

	/**
	 * @description 当前发言角色的ID。仅在角色发言时设置。
	 * @type {string}
	 */
	charname
	/**
	 * @description 当前发言玩家的ID。仅在玩家发言时设置。
	 * @type {string}
	 */
	playername
	/**
	 * @description 标记问候语的类型（如 'single', 'group', 'world_single'）。用于区分不同场景下的首次消息。
	 * @type {string}
	 */
	greeting_type

	/**
	 * @description 创建当前时间切片的深拷贝副本。
	 * 用于在状态变更时（如发送新消息）创建一个新的、独立的上下文。
	 * `charname`, `playername`, `greeting_type` 等临时状态不会被复制。
	 * @returns {timeSlice_t} 一个新的 timeSlice_t 实例。
	 */
	copy() {
		return Object.assign(new timeSlice_t(), this, {
			charname: undefined,
			playername: undefined,
			greeting_type: undefined,
			chars_memories: structuredClone(this.chars_memories)
		})
	}

	/**
	 * @description 将时间切片转换为可被JSON序列化的对象。
	 * 此方法主要用于数据持久化之前的中间步骤，它将复杂的API对象简化为其ID。
	 * @returns {{chars: string[], world: string, player: string, chars_memories: Record<string, any>, charname: string}} 序列化后的对象。
	 */
	toJSON() {
		return {
			chars: Object.keys(this.chars),
			world: this.world_id,
			player: this.player_id,
			chars_memories: this.chars_memories,
			charname: this.charname
		}
	}

	/**
	 * @description 将时间切片转换为用于存储到文件的数据格式。
	 * 这是 `saveChat` 流程的一部分，与 `toJSON` 类似，但为异步操作以支持未来可能的异步转换。
	 * @returns {Promise<{chars: string[], world: string, player: string, chars_memories: Record<string, any>, charname: string}>} 一个包含可序列化数据的 Promise。
	 */
	async toData() {
		return {
			chars: Object.keys(this.chars),
			world: this.world_id,
			player: this.player_id,
			chars_memories: this.chars_memories,
			charname: this.charname
		}
	}

	/**
	 * @description 从JSON反序列化对象中恢复 timeSlice_t 实例。
	 * 此方法会根据ID异步加载完整的角色、世界和玩家API对象。
	 * @param {any} json - 从文件中读取的JSON对象。
	 * @param {string} username - 该聊天所属的用户名，用于加载相关文件。
	 * @returns {Promise<timeSlice_t>} 一个填充了完整数据的 timeSlice_t 实例。
	 */
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

/**
 * @description 代表聊天记录中的单条消息条目。
 */
class chatLogEntry_t {
	/** @description 发言者显示的名称。 */
	name
	/** @description 发言者显示的头像URL或路径。 */
	avatar
	/** @description 消息的时间戳。 */
	time_stamp
	/** @description 消息发送者的角色（'user' 或 'char'）。 */
	role
	/** @description 消息的主要内容。 */
	content
	/** @description 用于前端展示的特殊格式化内容。 */
	content_for_show
	/** @description 用于前端编辑的原始内容。 */
	content_for_edit
	/** @description 此消息发出时的时间切片，包含了当时的完整上下文。 */
	timeSlice = new timeSlice_t()
	/** @description 附带的文件列表。 */
	files = []
	/** @description 扩展字段，用于存储插件或其他模块的附加信息。 */
	extension = {}

	/**
	 * @description 将聊天记录条目转换为可被JSON序列化的对象。
	 * @returns {object} 序列化后的对象。
	 */
	toJSON() {
		return {
			...this,
			timeSlice: this.timeSlice.toJSON(),
			files: this.files.map(file => ({
				...file,
				buffer: file.buffer.toString('base64')
			}))
		}
	}

	/**
	 * @description 将聊天记录条目转换为用于存储到文件的数据格式。
	 * 此方法会处理文件，将文件Buffer存入文件系统并用文件ID替换。
	 * @param {string} username - 当前操作的用户名，用于`addfile`。
	 * @returns {Promise<object>} 一个包含可序列化数据的 Promise。
	 */
	async toData(username) {
		return {
			...this,
			timeSlice: await this.timeSlice.toData(),
			files: await Promise.all(this.files.map(async file => ({
				...file,
				buffer: 'file:' + await addfile(username, file.buffer)
			})))
		}
	}

	/**
	 * @description 从JSON反序列化对象中恢复 chatLogEntry_t 实例。
	 * 此方法会处理文件，根据文件ID从文件系统中加载文件Buffer。
	 * @param {object} json - 从文件中读取的JSON对象。
	 * @param {string} username - 该聊天所属的用户名，用于加载相关文件。
	 * @returns {Promise<chatLogEntry_t>} 一个填充了完整数据的 chatLogEntry_t 实例。
	 */
	static async fromJSON(json, username) {
		return Object.assign(new chatLogEntry_t(), {
			...json,
			timeSlice: await timeSlice_t.fromJSON(json.timeSlice, username),
			files: await Promise.all(json.files.map(async file => ({
				...file,
				buffer: file.buffer.startsWith('file:') ? await getfile(username, file.buffer.slice(5)) : Buffer.from(file.buffer, 'base64')
			})))
		})
	}
}

/**
 * @description 描述一个完整聊天的元数据。
 */
class chatMetadata_t {
	/** @description 此聊天所属的用户名。 */
	username
	/** @description 主聊天记录，按时间顺序排列。 */
	/** @type {chatLogEntry_t[]} */
	chatLog = []
	/**
	 * @description 时间线分支数组。用于支持消息的“重新生成”功能。
	 * `chatLog`中最后一条消息，会对应`timeLines`中的多个可能版本。
	 */
	/** @type {chatLogEntry_t[]} */
	timeLines = []
	/**
	 * @description 当前在`timeLines`数组中选择的分支索引。
	 * @type {number}
	 */
	timeLineIndex = 0
	/**
	 * @description 聊天中最新的一个时间切片。代表了当前聊天的“实时”状态。
	 * @type {timeSlice_t}
	 */
	LastTimeSlice = new timeSlice_t()

	/**
	 * @param {string} username - 聊天的所有者用户名。
	 */
	constructor(username) {
		this.username = username
	}

	/**
	 * @description 创建一个新的聊天元数据实例。
	 * @param {string} username - 新聊天的所有者用户名。
	 * @returns {Promise<chatMetadata_t>} 一个新的 chatMetadata_t 实例。
	 */
	static async StartNewAs(username) {
		const metadata = new chatMetadata_t(username)

		metadata.LastTimeSlice.player_id = getDefaultParts(username).persona
		if (metadata.LastTimeSlice.player_id)
			metadata.LastTimeSlice.player = await loadPersona(username, metadata.LastTimeSlice.player_id)

		metadata.LastTimeSlice.world_id = getDefaultParts(username).world
		if (metadata.LastTimeSlice.world_id)
			metadata.LastTimeSlice.world = await loadWorld(username, metadata.LastTimeSlice.world_id)

		return metadata
	}

	/**
	 * @description 将聊天元数据转换为可被JSON序列化的对象。
	 * @returns {object} 序列化后的对象。
	 */
	toJSON() {
		return {
			username: this.username,
			chatLog: this.chatLog.map(log => log.toJSON()),
			timeLines: this.timeLines.map(entry => entry.toJSON()),
			timeLineIndex: this.timeLineIndex,
		}
	}

	/**
	 * @description 将聊天元数据转换为用于存储到文件的数据格式。
	 * @returns {Promise<object>} 一个包含可序列化数据的 Promise。
	 */
	async toData() {
		return {
			username: this.username,
			chatLog: await Promise.all(this.chatLog.map(async log => log.toData(this.username))),
			timeLines: await Promise.all(this.timeLines.map(async entry => entry.toData(this.username))),
			timeLineIndex: this.timeLineIndex,
		}
	}

	/**
	 * @description 从JSON反序列化对象中恢复 chatMetadata_t 实例。
	 * @param {object} json - 从文件中读取的JSON对象。
	 * @returns {Promise<chatMetadata_t>} 一个填充了完整数据的 chatMetadata_t 实例。
	 */
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

	/**
	 * @description 创建当前聊天元数据的深拷贝副本。
	 * @returns {Promise<chatMetadata_t>} 一个新的、独立的 chatMetadata_t 实例。
	 */
	copy() {
		return chatMetadata_t.fromJSON(this.toJSON())
	}
}

/**
 * @description 为指定的聊天ID创建一个新的、空的元数据实例。
 * @param {string} chatid - 聊天ID。
 * @param {string} username - 聊天的所有者用户名。
 */
export async function newMetadata(chatid, username) {
	chatMetadatas.set(chatid, { username, chatMetadata: await chatMetadata_t.StartNewAs(username) })
}

/**
 * @description 生成一个唯一的、当前未被使用的聊天ID。
 * @returns {string} 新的唯一聊天ID。
 */
export function findEmptyChatid() {
	while (true) {
		const uuid = Math.random().toString(36).substring(2, 15)
		if (!chatMetadatas.has(uuid)) return uuid
	}
}

/**
 * @description 创建一个全新的聊天。
 * @param {string} username - 新聊天的所有者用户名。
 * @returns {Promise<string>} 新创建的聊天的ID。
 */
export async function newChat(username) {
	const chatid = findEmptyChatid()
	await newMetadata(chatid, username)
	return chatid
}

/**
 * @description 将指定聊天的元数据保存到磁盘。
 * @param {string} chatid - 要保存的聊天ID。
 */
export async function saveChat(chatid) {
	const chatData = chatMetadatas.get(chatid)
	if (!chatData || !chatData.chatMetadata) return

	const { username, chatMetadata } = chatData
	fs.mkdirSync(getUserDictionary(username) + '/shells/chat/chats', { recursive: true })
	saveJsonFile(getUserDictionary(username) + '/shells/chat/chats/' + chatid + '.json', await chatMetadata.toData())
}

/**
 * @description 从内存缓存或磁盘加载指定聊天的元数据。
 * @param {string} chatid - 要加载的聊天ID。
 * @returns {Promise<chatMetadata_t | undefined>} 聊天的元数据对象，如果找不到则返回 undefined。
 */
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
 * @description 检查一个聊天是否是“活跃”的（即包含非问候语的消息）。
 * @param {chatMetadata_t} chatMetadata - 聊天的元数据。
 * @returns {boolean} 如果聊天是活跃的，则返回 true。
 */
function is_VividChat(chatMetadata) {
	return chatMetadata?.chatLog?.filter?.(entry => !entry.timeSlice?.greeting_type)?.length
}

/**
 * @description 为特定角色构建一个用于请求回复的上下文对象。
 * @param {string} chatid - 聊天ID。
 * @param {string} charname - 将要接收请求的角色ID。
 * @returns {Promise<import('../../decl/chatLog.ts').chatReplyRequest_t>} 为角色准备的请求对象。
 * @throws {Error} 如果聊天未找到。
 */
async function getChatRequest(chatid, charname) {
	const chatMetadata = await loadChat(chatid)
	if (!chatMetadata) throw new Error('Chat not found')

	const { username, LastTimeSlice: timeSlice } = chatMetadata
	const { locales } = getUserByUsername(username)
	const userinfo = await getPartInfo(timeSlice.player, locales) || {}
	const charinfo = await getPartInfo(timeSlice.chars[charname], locales) || {}
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
		char_id: charname,
		username,
		UserCharname,
		Charname: charinfo.name || charname,
		locales,
		chat_log: chatMetadata.chatLog,
		Update: () => getChatRequest(chatid, charname),
		AddChatLogEntry: async entry => {
			if (!chatMetadata.LastTimeSlice.chars[charname]) throw new Error('Char not in this chat')
			return addChatLogEntry(chatid, await BuildChatLogEntryFromCharReply(
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
		plugins: {},
		extension: {}
	}

	if (timeSlice.world?.interfaces?.chat?.GetChatLogForCharname)
		result.chat_log = await timeSlice.world.interfaces.chat.GetChatLogForCharname(result, charname)

	return result
}

/**
 * @description 在聊天中设置或更改玩家使用的人格。
 * @param {string} chatid - 聊天ID。
 * @param {string | null} personaname - 新的人格ID，或 null 表示移除人格。
 */
export async function setPersona(chatid, personaname) {
	const chatMetadata = await loadChat(chatid)
	const { LastTimeSlice: timeSlice, username } = chatMetadata
	if (!personaname) {
		timeSlice.player = undefined
		timeSlice.player_id = undefined
	}
	else {
		timeSlice.player = await loadPersona(username, personaname)
		timeSlice.player_id = personaname
	}

	if (is_VividChat(chatMetadata)) saveChat(chatid)
	broadcastChatEvent(chatid, { type: 'persona_set', payload: { personaname } })
}

/**
 * @description 在聊天中设置或更改世界。
 * @param {string} chatid - 聊天ID。
 * @param {string | null} worldname - 新的世界ID，或 null 表示移除世界。
 * @returns {Promise<chatLogEntry_t | null>} 如果世界有问候语，则返回该问候语消息条目。
 */
export async function setWorld(chatid, worldname) {
	const chatMetadata = await loadChat(chatid)
	if (!worldname) {
		chatMetadata.LastTimeSlice.world = undefined
		chatMetadata.LastTimeSlice.world_id = undefined
		if (is_VividChat(chatMetadata)) saveChat(chatid)
		broadcastChatEvent(chatid, { type: 'world_set', payload: { worldname: null } })
		return null
	}
	const { username, chatLog } = chatMetadata
	const timeSlice = chatMetadata.LastTimeSlice.copy()
	const world = timeSlice.world = await loadWorld(username, worldname)
	timeSlice.world_id = worldname
	if (world.interfaces.chat.GetGreeting && !chatLog.length)
		timeSlice.greeting_type = 'world_single'
	else if (world.interfaces.chat.GetGroupGreeting && chatLog.length > 0)
		timeSlice.greeting_type = 'world_group'

	broadcastChatEvent(chatid, { type: 'world_set', payload: { worldname } })

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
		if (!result)
			return

		const greeting_entrie = await BuildChatLogEntryFromCharReply(result, timeSlice, null, undefined, username)
		await addChatLogEntry(chatid, greeting_entrie) // 此处已广播
		return greeting_entrie
	}
	catch {
		chatMetadata.LastTimeSlice.world = timeSlice.world
		chatMetadata.LastTimeSlice.world_id = timeSlice.world_id
	}

	if (is_VividChat(chatMetadata)) saveChat(chatid)
	return null
}

/**
 * @description 向聊天中添加一个新角色。
 * @param {string} chatid - 聊天ID。
 * @param {string} charname - 要添加的角色ID。
 * @returns {Promise<chatLogEntry_t | null>} 如果角色有问候语，则返回该问候语消息条目。
 * @throws {Error} 如果聊天未找到。
 */
export async function addchar(chatid, charname) {
	const chatMetadata = await loadChat(chatid)
	if (!chatMetadata) throw new Error('Chat not found')

	const { username, chatLog } = chatMetadata
	const timeSlice = chatMetadata.LastTimeSlice.copy()
	if (chatLog.length > 0)
		timeSlice.greeting_type = 'group'
	else
		timeSlice.greeting_type = 'single'

	if (timeSlice.chars[charname])
		return null


	const char = timeSlice.chars[charname] = await LoadChar(username, charname)
	broadcastChatEvent(chatid, { type: 'char_added', payload: { charname } })

	// 获取问候语
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
		if (!result)
			return null

		const greeting_entrie = await BuildChatLogEntryFromCharReply(result, timeSlice, char, charname, username)
		await addChatLogEntry(chatid, greeting_entrie) // 此处已广播
		return greeting_entrie
	}
	catch (error) {
		console.error(error)
		chatMetadata.LastTimeSlice.chars[charname] = timeSlice.chars[charname]
	}
	if (is_VividChat(chatMetadata)) saveChat(chatid)
	return null
}

/**
 * @description 从聊天中移除一个角色。
 * @param {string} chatid - 聊天ID。
 * @param {string} charname - 要移除的角色ID。
 */
export async function removechar(chatid, charname) {
	const chatMetadata = await loadChat(chatid)
	delete chatMetadata.LastTimeSlice.chars[charname]
	if (is_VividChat(chatMetadata)) saveChat(chatid)
	broadcastChatEvent(chatid, { type: 'char_removed', payload: { charname } })
}

/**
 * @description 设置聊天中特定角色的发言频率。
 * @param {string} chatid - 聊天ID。
 * @param {string} charname - 角色ID。
 * @param {number} frequency - 新的发言频率乘数。
 */
export async function setCharSpeakingFrequency(chatid, charname, frequency) {
	const chatMetadata = await loadChat(chatid)
	chatMetadata.LastTimeSlice.chars_speaking_frequency[charname] = frequency
	if (is_VividChat(chatMetadata)) saveChat(chatid)
	broadcastChatEvent(chatid, { type: 'char_frequency_set', payload: { charname, frequency } })
}

/**
 * @description 获取聊天中的所有角色ID列表。
 * @param {string} chatid - 聊天ID。
 * @returns {Promise<string[]>} 角色ID的数组。
 */
export async function getCharListOfChat(chatid) {
	const chatMetadata = await loadChat(chatid)
	return Object.keys(chatMetadata.LastTimeSlice.chars)
}

/**
 * @description 获取指定范围的聊天记录。
 * @param {string} chatid - 聊天ID。
 * @param {number} start - 起始索引。
 * @param {number} end - 结束索引。
 * @returns {Promise<chatLogEntry_t[]>} 聊天记录条目的数组。
 */
export async function GetChatLog(chatid, start, end) {
	const chatMetadata = await loadChat(chatid)
	return chatMetadata.chatLog.slice(start, end)
}

/**
 * @description 获取聊天记录的总长度。
 * @param {string} chatid - 聊天ID。
 * @returns {Promise<number>} 聊天记录的长度。
 */
export async function GetChatLogLength(chatid) {
	const chatMetadata = await loadChat(chatid)
	return chatMetadata.chatLog.length
}

/**
 * @description 获取当前聊天中用户使用的人格名称。
 * @param {string} chatid - 聊天ID。
 * @returns {Promise<string>} 人格ID。
 */
export async function GetUserPersonaName(chatid) {
	const chatMetadata = await loadChat(chatid)
	return chatMetadata.LastTimeSlice.player_id
}

/**
 * @description 获取当前聊天中使用的世界名称。
 * @param {string} chatid - 聊天ID。
 * @returns {Promise<string>} 世界ID。
 */
export async function GetWorldName(chatid) {
	const chatMetadata = await loadChat(chatid)
	return chatMetadata.LastTimeSlice.world_id
}

/**
 * @description 向聊天中添加一条新的消息条目，并处理后续逻辑（如自动回复）。
 * @param {string} chatid - 聊天ID。
 * @param {chatLogEntry_t} entry - 要添加的聊天记录条目。
 * @returns {Promise<chatLogEntry_t>} 已添加的聊天记录条目。
 */
async function handleAutoReply(chatid, freq_data, initial_char) {
	let char = initial_char
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
}

async function addChatLogEntry(chatid, entry) {
	const chatMetadata = await loadChat(chatid)
	if (entry.timeSlice.world?.interfaces?.chat?.AddChatLogEntry)
		await entry.timeSlice.world.interfaces.chat.AddChatLogEntry(await getChatRequest(chatid, undefined), entry)
	else
		chatMetadata.chatLog.push(entry)

	// 更新最后一条消息的时间线分支
	chatMetadata.timeLines = [entry]
	chatMetadata.timeLineIndex = 0
	chatMetadata.LastTimeSlice = entry.timeSlice

	if (is_VividChat(chatMetadata)) saveChat(chatid)
	broadcastChatEvent(chatid, { type: 'message_added', payload: await entry.toData(chatMetadata.username) })

	// If the message is from a character, send a push notification via the service worker.
	if (entry.role === 'char')
		sendNotification(chatMetadata.username, entry.name ?? 'Character', {
			body: entry.content,
			icon: entry.avatar || '/favicon.svg', // Use a default icon
			data: {
				url: `/shells/chat/#${chatid}`, // URL to open on click
			},
		}, `/shells/chat/#${chatid}`)

	const freq_data = await getCharReplyFrequency(chatid)
	if (entry.timeSlice.world?.interfaces?.chat?.AfterAddChatLogEntry)
		await entry.timeSlice.world.interfaces.chat.AfterAddChatLogEntry(await getChatRequest(chatid, undefined), freq_data)
	else
		handleAutoReply(chatid, freq_data, entry.timeSlice.charname ?? null)

	return entry
}
/**
 * @description 修改当前消息的时间线（“重新生成”功能）。
 * @param {string} chatid - 聊天ID。
 * @param {number} delta - 切换时间线的偏移量（例如，1 表示下一个，-1 表示上一个）。
 * @returns {Promise<chatLogEntry_t>} 新的当前消息条目。
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
			try {
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
			}
			catch (e) {
				result = {
					content: ['```', e.message, e.stack || '', '```'].filter(Boolean).join('\n'),
				}
			}
			if (!result) throw new Error('No reply')
			let entry
			if (new_timeSlice.greeting_type?.startsWith?.('world_'))
				entry = await BuildChatLogEntryFromCharReply(result, new_timeSlice, null, undefined, chatMetadata.username)
			else
				entry = await BuildChatLogEntryFromCharReply(result, new_timeSlice, char, charname, chatMetadata.username)

			if (entry.timeSlice.world.interfaces?.chat?.AddChatLogEntry)
				entry.timeSlice.world.interfaces.chat.AddChatLogEntry(await getChatRequest(chatid, undefined), entry)
			else
				chatMetadata.chatLog.push(entry)

			// 更新时间线
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
	chatMetadata.chatLog[chatMetadata.chatLog.length - 1] = entry
	broadcastChatEvent(chatid, { type: 'message_replaced', payload: { index: chatMetadata.chatLog.length - 1, entry: await entry.toData(chatMetadata.username) } })

	return entry
}

/**
 * @description 根据角色的回复数据构建一个标准的聊天记录条目。
 * @param {object} result - 角色接口返回的回复对象。
 * @param {string} result.name - 发言者名称。
 * @param {string} result.avatar - 发言者头像。
 * @param {string} result.content - 消息内容。
 * @param {any} result.extension - 扩展数据。
 * @param {timeSlice_t} new_timeSlice - 用于此消息的时间切片。
 * @param {CharAPI_t} char - 发言的角色对象。
 * @param {string} charname - 发言的角色ID。
 * @param {string} username - 聊天的所有者用户名。
 * @returns {Promise<chatLogEntry_t>} 构建完成的聊天记录条目。
 */
async function BuildChatLogEntryFromCharReply(result, new_timeSlice, char, charname, username) {
	const { locales } = getUserByUsername(username)
	new_timeSlice.charname = charname
	const info = await getPartInfo(char, locales) || {}

	return Object.assign(new chatLogEntry_t(), {
		name: result.name || info.name || charname || 'Unknown',
		avatar: result.avatar || info.avatar,
		content: result.content,
		content_for_show: result.content_for_show,
		content_for_edit: result.content_for_edit,
		timeSlice: new_timeSlice,
		role: 'char',
		time_stamp: new Date(),
		files: result.files || [],
		extension: result.extension || {},
		logContextBefore: result.logContextBefore,
		logContextAfter: result.logContextAfter
	})
}

/**
 * @description 根据用户的输入数据构建一个标准的聊天记录条目。
 * @param {object} result - 用户发送的消息对象。
 * @param {string} result.name - 发言者名称。
 * @param {string} result.avatar - 发言者头像。
 * @param {string} result.content - 消息内容。
 * @param {any} result.extension - 扩展数据。
 * @param {timeSlice_t} new_timeSlice - 用于此消息的时间切片。
 * @param {UserAPI_t} user - 发言的用户人格对象。
 * @param {string} username - 聊天的所有者用户名。
 * @returns {Promise<chatLogEntry_t>} 构建完成的聊天记录条目。
 */
async function BuildChatLogEntryFromUserMessage(result, new_timeSlice, user, username) {
	const { locales } = getUserByUsername(username)
	new_timeSlice.playername = new_timeSlice.player_id
	const info = await getPartInfo(user, locales) || {}

	return Object.assign(new chatLogEntry_t(), {
		name: result.name || info.name || new_timeSlice.player_id || username,
		avatar: result.avatar || info.avatar,
		content: result.content,
		timeSlice: new_timeSlice,
		role: 'user',
		time_stamp: new Date(),
		files: result.files || [],
		extension: result.extension || {}
	})
}

/**
 * @description 计算并获取当前聊天中所有参与者的发言频率数据。
 * @param {string} chatid - 聊天ID。
 * @returns {Promise<{charname: string | null, frequency: number}[]>} 包含每个参与者（null代表用户）及其发言频率的数组。
 * @throws {Error} 如果聊天未找到。
 */
async function getCharReplyFrequency(chatid) {
	const chatMetadata = await loadChat(chatid)
	if (!chatMetadata) throw new Error('Chat not found')
	const result = [
		{
			charname: null, // null 代表用户
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

/**
 * @description 根据频率数据随机选择下一个发言的角色。
 * @param {{charname: string, frequency: number}[]} frequency_data - 频率数据数组。
 * @returns {Promise<string | undefined>} 下一个发言的角色ID，如果没有可选角色则返回 undefined。
 */
async function getNextCharForReply(frequency_data) {
	const all_freq = frequency_data.map(x => x.frequency).reduce((a, b) => a + b, 0)
	let random = Math.random() * all_freq

	for (const { charname, frequency } of frequency_data)
		if (random < frequency) return charname
		else random -= frequency
}

/**
 * @description 触发一个角色进行回复。
 * @param {string} chatid - 聊天ID。
 * @param {string | null} charname - 要触发回复的角色ID。如果为 null，则会根据频率随机选择一个角色。
 * @returns {Promise<chatLogEntry_t | undefined>} 如果成功生成回复，则返回新的消息条目。
 * @throws {Error} 如果聊天或角色未找到。
 */
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

	try {
		if (timeSlice?.world?.interfaces?.chat?.GetCharReply)
			result = await timeSlice.world.interfaces.chat.GetCharReply(request, charname)
		else
			result = await char.interfaces.chat.GetReply(request)
	}
	catch (e) {
		result = {
			content: ['```', e.message, e.stack || '', '```'].filter(Boolean).join('\n'),
		}
	}

	if (!result) return
	const new_timeSlice = timeSlice.copy()

	return addChatLogEntry(chatid, await BuildChatLogEntryFromCharReply(result, new_timeSlice, char, charname, chatMetadata.username))
}

/**
 * @description 添加一条用户的回复到聊天记录中。
 * @param {string} chatid - 聊天ID。
 * @param {object} object - 包含用户消息内容的对象。
 * @returns {Promise<chatLogEntry_t>} 新增的用户消息条目。
 * @throws {Error} 如果聊天未找到。
 */
export async function addUserReply(chatid, object) {
	const chatMetadata = await loadChat(chatid)
	if (!chatMetadata) throw new Error('Chat not found')

	const timeSlice = chatMetadata.LastTimeSlice
	const new_timeSlice = timeSlice.copy()
	const user = timeSlice.player

	return addChatLogEntry(chatid, await BuildChatLogEntryFromUserMessage(object, new_timeSlice, user, chatMetadata.username))
}

/**
 * @description 从JSON文件轻量级加载聊天的摘要信息，不进行完整的对象水合。
 * 这种方式速度更快，因为它避免了加载完整的角色/世界/人格数据。
 * @param {string} username - 聊天的所有者用户名。
 * @param {string} chatid - 聊天ID。
 * @returns {Promise<{
 *   chatid: string,
 *   chars: string[],
 *   lastMessageSender: string,
 *   lastMessageSenderAvatar: string | null,
 *   lastMessageContent: string,
 *   lastMessageTime: Date,
 * } | null>} 聊天的摘要信息，或在加载失败时返回 null。
 */
async function loadChatSummary(username, chatid) {
	const filepath = getUserDictionary(username) + '/shells/chat/chats/' + chatid + '.json'
	if (!fs.existsSync(filepath)) return null

	try {
		const rawChatData = loadJsonFile(filepath)
		const lastEntry = rawChatData.chatLog[rawChatData.chatLog.length - 1]
		const chars = lastEntry.timeSlice?.chars || []
		return {
			chatid,
			chars,
			lastMessageSender: lastEntry.name || 'Unknown',
			lastMessageSenderAvatar: lastEntry.avatar || null,
			lastMessageContent: lastEntry.content || '',
			lastMessageTime: new Date(lastEntry.time_stamp), // 确保是Date对象
		}
	}
	catch (error) {
		console.error(`Failed to load summary for chat ${chatid}:`, error)
		return null
	}
}

/**
 * @description 获取指定用户的所有聊天列表，包含摘要信息。
 * @param {string} username - 用户名。
 * @returns {Promise<Array>} 包含聊天摘要对象的数组，按最后消息时间降序排列。
 */
export async function getChatList(username) {
	const userDir = getUserDictionary(username) + '/shells/chat/chats/'
	if (!fs.existsSync(userDir)) return []

	const chatFiles = fs.readdirSync(userDir).filter(file => file.endsWith('.json'))
	const chatIdsOnDisk = new Set(chatFiles.map(file => file.replace('.json', '')))

	for (const [chatid, data] of chatMetadatas.entries())
		if (data.username === username)
			chatIdsOnDisk.add(chatid)

	const chatListPromises = Array.from(chatIdsOnDisk).map(async chatid => {
		const cachedData = chatMetadatas.get(chatid)

		if (cachedData?.chatMetadata) {
			const { chatMetadata } = cachedData
			if (!is_VividChat(chatMetadata)) return null

			const lastEntry = chatMetadata.chatLog[chatMetadata.chatLog.length - 1]
			return {
				chatid,
				chars: Object.keys(chatMetadata.LastTimeSlice.chars),
				lastMessageSender: lastEntry.name,
				lastMessageSenderAvatar: lastEntry.avatar || null,
				lastMessageContent: lastEntry.content,
				lastMessageTime: lastEntry.time_stamp,
			}
		}

		return await loadChatSummary(username, chatid)
	})
	const chatList = (await Promise.all(chatListPromises)).filter(Boolean)
	return chatList.sort((a, b) => b.lastMessageTime - a.lastMessageTime)
}

/**
 * @description 删除一个或多个聊天。
 * @param {string[]} chatids - 要删除的聊天ID数组。
 * @param {string} username - 操作的用户名。
 * @returns {Promise<{chatid: string, success: boolean, message: string, error?: string}[]>} 每个聊天删除操作的结果数组。
 */
export async function deleteChat(chatids, username) {
	const basedir = getUserDictionary(username) + '/shells/chat/chats/'
	const deletePromises = chatids.map(async chatid => {
		try {
			if (fs.existsSync(basedir + chatid + '.json')) await fs.promises.unlink(basedir + chatid + '.json')
			chatMetadatas.delete(chatid)
			return { chatid, success: true, message: 'Chat deleted successfully' }
		}
		catch (error) {
			console.error(`Error deleting chat ${chatid}:`, error)
			return { chatid, success: false, message: 'Error deleting chat', error: error.message }
		}
	})

	return Promise.all(deletePromises)
}

/**
 * @description 复制一个或多个聊天。
 * @param {string[]} chatids - 要复制的聊天ID数组。
 * @param {string} username - 操作的用户名。
 * @returns {Promise<{chatid: string, success: boolean, newChatId?: string, message: string}[]>} 每个聊天复制操作的结果数组。
 */
export async function copyChat(chatids, username) {
	const copyPromises = chatids.map(async chatid => {
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

/**
 * @description 导出指定的聊天数据。
 * @param {string[]} chatids - 要导出的聊天ID数组。
 * @returns {Promise<{chatid: string, success: boolean, data?: chatMetadata_t, message: string, error?: string}[]>} 每个聊天导出操作的结果数组。
 */
export async function exportChat(chatids) {
	const exportPromises = chatids.map(async chatid => {
		try {
			const chat = await loadChat(chatid)
			if (!chat) return { chatid, success: false, message: 'Chat not found', error: 'Chat not found' }
			return { chatid, success: true, data: chat }
		}
		catch (error) {
			console.error(`Error exporting chat ${chatid}:`, error)
			return { chatid, success: false, message: 'Error exporting chat', error: error.message }
		}
	})

	return Promise.all(exportPromises)
}

/**
 * @description 从聊天中删除一条指定索引的消息。
 * @param {string} chatid - 聊天ID。
 * @param {number} index - 要删除的消息在 `chatLog` 中的索引。
 * @throws {Error} 如果聊天未找到或索引无效。
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
	// 若有world，让world处理消息删除
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
	broadcastChatEvent(chatid, { type: 'message_deleted', payload: { index } })
}

/**
 * @description 编辑聊天中的一条指定消息。
 * @param {string} chatid - 聊天ID。
 * @param {number} index - 要编辑的消息在 `chatLog` 中的索引。
 * @param {string} new_content - 新的消息内容。
 * @returns {Promise<chatLogEntry_t>} 编辑后的消息条目。
 * @throws {Error} 如果聊天未找到或索引无效。
 */
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
	// 若有world，让world处理消息编辑
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
		entry = await BuildChatLogEntryFromCharReply(editresult, timeSlice, char, timeSlice.charname, chatMetadata.username)
	}
	else
		entry = await BuildChatLogEntryFromUserMessage(editresult, timeSlice, chatMetadata.LastTimeSlice, chatMetadata.username)

	chatMetadata.chatLog[index] = entry
	if (index == chatMetadata.chatLog.length - 1)
		chatMetadata.timeLines[chatMetadata.timeLineIndex] = entry

	if (is_VividChat(chatMetadata)) saveChat(chatid)
	broadcastChatEvent(chatid, { type: 'message_edited', payload: { index, entry: await entry.toData(chatMetadata.username) } })

	return entry
}

/**
 * @description 获取用于客户端初始化的数据。
 * @param {string} chatid - 聊天ID。
 * @returns {Promise<object>} 包含聊天状态和消息的心跳数据。
 */
export async function getInitialData(chatid) {
	const chatMetadata = await loadChat(chatid)
	if (!chatMetadata) throw skip_report(new Error('Chat not found'))
	const timeSlice = chatMetadata.LastTimeSlice
	return {
		charlist: Object.keys(timeSlice.chars),
		worldname: timeSlice.world_id,
		personaname: timeSlice.player_id,
		frequency_data: timeSlice.chars_speaking_frequency,
		logLength: chatMetadata.chatLog.length,
		initialLog: await Promise.all(chatMetadata.chatLog.slice(-20).map(x => x.toData(chatMetadata.username))),
	}
}

// 事件处理器
events.on('AfterUserDeleted', async payload => {
	const { username } = payload
	// 从内存缓存中清除
	const chatIdsToDeleteFromCache = []
	for (const [chatId, data] of chatMetadatas.entries())
		if (data.username === username)
			chatIdsToDeleteFromCache.push(chatId)
	chatIdsToDeleteFromCache.forEach(chatId => chatMetadatas.delete(chatId))
})

events.on('AfterUserRenamed', async ({ oldUsername, newUsername }) => {
	// 更新内存缓存：chatMetadatas 映射表
	for (const [chatId, data] of chatMetadatas.entries())
		if (data.username === oldUsername) {
			data.username = newUsername // 更新映射表值中的用户名
			if (data.chatMetadata && data.chatMetadata.username === oldUsername)
				data.chatMetadata.username = newUsername // 更新缓存对象自身的用户名
			saveChat(chatId)
		}
})
