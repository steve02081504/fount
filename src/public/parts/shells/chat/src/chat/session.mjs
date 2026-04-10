/** @typedef {import('../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../../decl/userAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../../decl/pluginAPI.ts').PluginAPI_t} PluginAPI_t */
/** @typedef {import('../../../../../../decl/basedefs.ts').locale_t} locale_t */

import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import { inspect } from 'node:util'

import { loadJsonFile, saveJsonFile } from '../../../../../../scripts/json_loader.mjs'
import { getPartInfo } from '../../../../../../scripts/locale.mjs'
import { ms } from '../../../../../../scripts/ms.mjs'
import { getUserByUsername, getUserDictionary, getAllUserNames } from '../../../../../../server/auth.mjs'
import { events } from '../../../../../../server/events.mjs'
import { getAllDefaultParts, getAnyDefaultPart, getPartDetails, loadPart } from '../../../../../../server/parts_loader.mjs'
import { skip_report } from '../../../../../../server/server.mjs'
import { loadShellData, saveShellData } from '../../../../../../server/setting_loader.mjs'
import { sendNotification } from '../../../../../../server/web_server/event_dispatcher.mjs'
import { unlockAchievement } from '../../../achievements/src/api.mjs'

import { addfile, getfile } from '../files.mjs'
import { appendEvent, broadcastEvent as broadcastGroupEvent, bufferStreamChunk, finishStreamBuffer, deleteChatData, ensureChat, listChannelMessages, getDefaultChannelId } from './dag.mjs'
import { generateDiff, createBufferedSyncPreviewUpdater } from '../stream.mjs'

const activeStreams = new Map()
const StreamManager = {
	/**
	 * 创建流式生成任务。
	 * @param {string} chatId - 聊天ID。
	 * @param {string} messageId - 消息的唯一ID，绑定到消息UUID。
	 * @returns {{id: string, signal: AbortSignal, update: Function, done: Function, abort: Function}} - 流式生成任务的控制对象。
	 */
	create(chatId, messageId) {
		const streamId = crypto.randomUUID()
		const controller = new AbortController()

		const context = {
			chatId,
			messageId,
			lastMessage: { content: '', files: [] },
			controller,
		}

		activeStreams.set(streamId, context)

		const syncUpdate = createBufferedSyncPreviewUpdater((newMessage) => {
			if (context.controller.signal.aborted) return
			const slices = generateDiff(context.lastMessage, newMessage)
			if (slices.length > 0) {
				context.lastMessage = structuredClone(newMessage)
				broadcastChatEvent(chatId, {
					type: 'stream_update',
					payload: { messageId, slices },
				})
			}
		})

		return {
			id: streamId,
			signal: controller.signal,

			/**
			 * CharAPI 调用此方法更新流式消息内容。
			 * @param {object} newMessage - 新的消息内容，包含文本和文件。
			 */
			update(newMessage) {
				if (context.controller.signal.aborted) return
				syncUpdate(newMessage)
			},

			/** 正常结束 */
			done() {
				activeStreams.delete(streamId)
			},

			/**
			 * 触发中断
			 * @param {string} reason - 中断原因
			 */
			abort(reason = 'User Aborted') {
				if (context.controller.signal.aborted) return
				const error = new Error(reason)
				error.name = 'AbortError'
				context.controller.abort(error)
				activeStreams.delete(streamId)
			},
		}
	},

	/**
	 * 根据消息ID中止流式生成任务。
	 * @param {string} messageId - 要中止的消息唯一ID。
	 */
	abortByMessageId(messageId) {
		for (const [id, ctx] of activeStreams)
			if (ctx.messageId === messageId) {
				if (ctx.controller.signal.aborted) continue
				const error = new Error('User Aborted')
				error.name = 'AbortError'
				ctx.controller.abort(error)
				activeStreams.delete(id)
				break
			}
	},

	/**
	 * 中止某个聊天的所有流式生成任务。
	 * @param {string} chatId - 要中止流式生成任务的聊天ID。
	 */
	abortAll(chatId) {
		for (const [id, ctx] of activeStreams)
			if (ctx.chatId === chatId) {
				if (ctx.controller.signal.aborted) continue
				const error = new Error('User Aborted')
				error.name = 'AbortError'
				ctx.controller.abort(error)
				activeStreams.delete(id)
			}
	},
}

/**
 * @type {Map<string, { username: string, chatMetadata: chatMetadata_t | null }>}
 */
const chatMetadatas = new Map()
const chatUiSockets = new Map()
const typingStatus = new Map()
const chatDeleteTimers = new Map()
const CHAT_UNLOAD_TIMEOUT = ms('30m')

/**
 * 更新并广播输入状态。
 * @param {string} chatid - 聊天ID。
 * @param {string} charname - 角色名称。
 * @param {number} delta - 变化量 (+1 或 -1)。
 */
function updateTypingStatus(chatid, charname, delta) {
	if (!typingStatus.has(chatid)) typingStatus.set(chatid, new Map())
	const chatMap = typingStatus.get(chatid)
	const current = chatMap.get(charname) || 0
	const next = current + delta
	if (next <= 0) chatMap.delete(charname)
	else chatMap.set(charname, next)

	const typingList = Array.from(chatMap.keys())
	broadcastChatEvent(chatid, { type: 'typing_status', payload: { typingList } })
}

function getTypingList(chatid) {
	const chatMap = typingStatus.get(chatid)
	return chatMap ? Array.from(chatMap.keys()) : []
}

/**
 * 注册聊天UI WebSocket。
 * @param {string} chatid - 聊天ID。
 * @param {import('npm:ws').WebSocket} ws - WebSocket实例。
 */
export function registerChatUiSocket(chatid, ws) {
	if (chatDeleteTimers.has(chatid)) {
		clearTimeout(chatDeleteTimers.get(chatid))
		chatDeleteTimers.delete(chatid)
	}

	if (!chatUiSockets.has(chatid))
		chatUiSockets.set(chatid, new Set())

	const socketSet = chatUiSockets.get(chatid)
	socketSet.add(ws)

	const typingList = getTypingList(chatid)
	if (typingList.length > 0)
		ws.send(JSON.stringify({ type: 'typing_status', payload: { typingList } }))

	ws.on('message', (message) => {
		try {
			const msg = JSON.parse(message)
			if (msg.type === 'stop_generation' && msg.payload?.messageId)
				StreamManager.abortByMessageId(msg.payload.messageId)
		}
		catch (e) {
			console.error('Error processing client websocket message:', e)
		}
	})

	ws.on('close', () => {
		socketSet.delete(ws)
		const chatData = chatMetadatas.get(chatid)
		if (!socketSet.size && chatUiSockets.delete(chatid)) {
			StreamManager.abortAll(chatid)
			clearTimeout(chatDeleteTimers.get(chatid))
			chatDeleteTimers.set(chatid, setTimeout(async () => {
				try {
					if (!chatData || chatUiSockets.has(chatid)) return
					if (is_VividChat(chatData.chatMetadata)) {
						await saveChat(chatid)
						chatData.chatMetadata = null
					}
					else await deleteChat([chatid], chatData.username)
				}
				finally {
					chatDeleteTimers.delete(chatid)
				}
			}, CHAT_UNLOAD_TIMEOUT))
		}
	})
}

/**
 * 导入一个聊天记录。
 * @param {object} chatData - 要导入的聊天数据。
 * @param {string} username - 操作的用户名。
 * @returns {Promise<{success: boolean, newChatId?: string, message: string}>} 操作结果。
 */
export async function importChat(chatData, username) {
	const newChatId = await newChat(username)
	const importedMetadata = await chatMetadata_t.fromJSON({ ...chatData, username })

	chatMetadatas.set(newChatId, { username, chatMetadata: importedMetadata })
	await saveChat(newChatId)
	return { success: true, newChatId, message: 'Chat imported successfully' }
}

/**
 * 广播聊天事件。
 * @param {string} chatid - 聊天ID。
 * @param {object} event - 要广播的事件。
 */
function broadcastChatEvent(chatid, event) {
	const sockets = chatUiSockets.get(chatid)
	if (!sockets?.size) return

	const message = JSON.stringify(event)
	for (const ws of sockets)
		if (ws.readyState === ws.OPEN)
			ws.send(message)
}

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
 * 代表聊天中特定时间点的"时间切片"，包含了该时刻的所有上下文状态。
 */
class timeSlice_t {
	/** @type {Record<string, CharAPI_t>} */
	chars = {}
	/** @type {Record<string, PluginAPI_t>} */
	plugins = {}
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
	/** @type {string} */
	charname
	/** @type {string} */
	playername
	/** @type {string} */
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
			plugins: Object.keys(this.plugins),
			world: this.world_id,
			player: this.player_id,
			chars_memories: this.chars_memories,
			charname: this.charname
		}
	}

	async toData() {
		return {
			chars: Object.keys(this.chars),
			plugins: Object.keys(this.plugins),
			world: this.world_id,
			player: this.player_id,
			chars_memories: this.chars_memories,
			charname: this.charname
		}
	}

	static async fromJSON(json, username) {
		return Object.assign(new timeSlice_t(), {
			...json,
			chars: Object.fromEntries(await Promise.all(
				(json.chars || []).map(async charname => [charname, await loadPart(username, 'chars/' + charname).catch(() => { })])
			)),
			plugins: Object.fromEntries(await Promise.all(
				(json.plugins || []).map(async plugin => [plugin, await loadPart(username, 'plugins/' + plugin).catch(() => { })])
			)),
			world_id: json.world,
			world: json.world ? await loadPart(username, 'worlds/' + json.world).catch(() => { }) : undefined,
			player_id: json.player,
			player: json.player ? await loadPart(username, 'personas/' + json.player).catch(() => { }) : undefined,
		})
	}
}

/**
 * 代表聊天记录中的单条消息条目。
 */
class chatLogEntry_t {
	/** @type {string} */
	id
	name
	avatar
	time_stamp
	role
	content
	content_for_show
	content_for_edit
	timeSlice = new timeSlice_t()
	files = []
	extension = {}
	/** @type {boolean} */
	is_generating = false

	constructor() {
		this.id = crypto.randomUUID()
	}

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

	static async fromJSON(json, username) {
		const instance = Object.assign(new chatLogEntry_t(), {
			...json,
			timeSlice: await timeSlice_t.fromJSON(json.timeSlice, username),
			files: await Promise.all((json.files || []).map(async file => ({
				...file,
				buffer: file.buffer.startsWith('file:') ? await getfile(username, file.buffer.slice(5)) : Buffer.from(file.buffer, 'base64')
			})))
		})
		if (!instance.id)
			instance.id = crypto.randomUUID()

		return instance
	}
}

/**
 * 描述一个完整聊天的元数据。每个聊天天然对应一个 DAG 群组（groupId === chatId）。
 */
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

		metadata.LastTimeSlice.player_id = getAnyDefaultPart(username, 'personas')
		if (metadata.LastTimeSlice.player_id)
			metadata.LastTimeSlice.player = await loadPart(username, 'personas/' + metadata.LastTimeSlice.player_id)

		metadata.LastTimeSlice.world_id = getAnyDefaultPart(username, 'worlds')
		if (metadata.LastTimeSlice.world_id)
			metadata.LastTimeSlice.world = await loadPart(username, 'worlds/' + metadata.LastTimeSlice.world_id)

		metadata.LastTimeSlice.plugins = Object.fromEntries(await Promise.all(
			getAllDefaultParts(username, 'plugins').map(async plugin => [
				plugin,
				await loadPart(username, 'plugins/' + plugin)
			])
		))

		return metadata
	}

	toJSON() {
		return {
			username: this.username,
			chatLogPrelude: this.chatLog.filter(e => e.timeSlice?.greeting_type).map(log => log.toJSON()),
			persistedTimeSlice: this.LastTimeSlice.toJSON?.() ?? {},
			chatLog: [],
			timeLines: [],
			timeLineIndex: 0,
		}
	}

	async toData() {
		const prelude = this.chatLog.filter(e => e.timeSlice?.greeting_type)
		return {
			username: this.username,
			chatLogPrelude: await Promise.all(prelude.map(async log => log.toData(this.username))),
			persistedTimeSlice: await this.LastTimeSlice.toData(),
			chatLog: [],
			timeLines: [],
			timeLineIndex: 0,
		}
	}

	static async fromJSON(json) {
		const rawChatLog = Array.isArray(json.chatLog) ? json.chatLog : []

		// 向后兼容：旧格式 chatLog 不为空则直接加载（未迁移到 DAG 存储的旧聊天）
		let chatLog
		let needsHydration = false
		if (rawChatLog.length === 0) {
			chatLog = await Promise.all((json.chatLogPrelude || []).map(data => chatLogEntry_t.fromJSON(data, json.username)))
			needsHydration = true
		}
		else {
			chatLog = await Promise.all(rawChatLog.map(data => chatLogEntry_t.fromJSON(data, json.username)))
		}

		const timeLines = rawChatLog.length === 0
			? []
			: await Promise.all((json.timeLines || []).map(entry => chatLogEntry_t.fromJSON(entry, json.username)))

		for (const entry of chatLog)
			if (entry.is_generating) entry.is_generating = false

		for (const entry of timeLines)
			if (entry.is_generating) entry.is_generating = false

		let LastTimeSlice
		if (rawChatLog.length === 0) {
			LastTimeSlice = json.persistedTimeSlice
				? await timeSlice_t.fromJSON(json.persistedTimeSlice, json.username)
				: (chatLog.length ? chatLog[chatLog.length - 1].timeSlice : new timeSlice_t())
		}
		else
			LastTimeSlice = chatLog.length ? chatLog[chatLog.length - 1].timeSlice : new timeSlice_t()

		return Object.assign(new chatMetadata_t(), {
			username: json.username,
			chatLog,
			timeLines,
			timeLineIndex: json.timeLineIndex ?? 0,
			LastTimeSlice,
			_needsDagHydration: needsHydration,
		})
	}

	copy() {
		return chatMetadata_t.fromJSON(this.toJSON())
	}
}

/**
 * 为指定的聊天ID创建一个新的、空的元数据实例。
 * @param {string} chatid - 聊天ID。
 * @param {string} username - 聊天的所有者用户名。
 */
export async function newMetadata(chatid, username) {
	chatMetadatas.set(chatid, { username, chatMetadata: await chatMetadata_t.StartNewAs(username) })
}

export function findEmptyChatid() {
	while (true) {
		const uuid = Math.random().toString(36).substring(2, 15)
		if (!chatMetadatas.has(uuid)) return uuid
	}
}

/**
 * 创建一个全新的聊天（每个聊天天然对应一个群，groupId === chatId）。
 * @param {string} username - 新聊天的所有者用户名。
 * @param {{ name?: string, defaultChannelName?: string }} [options]
 * @returns {Promise<string>} 新创建的聊天的ID。
 */
export async function newChat(username, options = {}) {
	const chatid = findEmptyChatid()
	await newMetadata(chatid, username)
	await ensureChat(username, chatid, {
		name: options.name || '聊天',
		defaultChannelName: options.defaultChannelName,
	})
	return chatid
}

function getSummaryFromMetadata(chatid, chatMetadata) {
	if (!is_VividChat(chatMetadata)) return null
	const lastEntry = chatMetadata.chatLog[chatMetadata.chatLog.length - 1]
	if (!lastEntry) return null
	return {
		chatid,
		chars: Object.keys(chatMetadata.LastTimeSlice.chars),
		lastMessageSender: lastEntry.name,
		lastMessageSenderAvatar: lastEntry.avatar || null,
		lastMessageContent: lastEntry.content,
		lastMessageTime: lastEntry.time_stamp,
	}
}

async function updateChatSummary(chatid, chatMetadata) {
	const { username } = chatMetadatas.get(chatid)

	if (!chatMetadata) chatMetadata = await loadChat(chatid)

	const summary = getSummaryFromMetadata(chatid, chatMetadata)
	const summariesCache = loadShellData(username, 'chat', 'chat_summaries_cache')
	if (summary) summariesCache[chatid] = summary
	else delete summariesCache[chatid]

	saveShellData(username, 'chat', 'chat_summaries_cache')
}

/**
 * 从 DAG default 频道行构造 chatLog 条目。
 * @param {object} line
 * @param {timeSlice_t} baseSlice
 * @param {{ text?: string, fileCount?: number } | undefined} editOverride
 */
function buildChatLogEntryFromDagMessage(line, baseSlice, editOverride) {
	const c = line.content || {}
	const entry = new chatLogEntry_t()
	entry.id = c.chatLogEntryId || line.eventId
	const text = editOverride?.text != null ? editOverride.text : c.text
	entry.content = text ?? ''
	entry.role = c.role || 'user'
	const charId = line.charId || c.charId
	if (entry.role === 'char') {
		entry.name = charId || 'char'
		entry.timeSlice = baseSlice.copy()
		entry.timeSlice.charname = charId
	}
	else if (entry.role === 'user') {
		entry.name = 'user'
		entry.timeSlice = baseSlice.copy()
	}
	else {
		entry.name = line.sender || entry.role || 'system'
		entry.timeSlice = baseSlice.copy()
	}
	const ts = line.timestamp ?? Date.now()
	entry.time_stamp = new Date(ts).toISOString()
	const fc = editOverride?.fileCount != null ? editOverride.fileCount : c.fileCount
	if (fc != null) entry.extension = { ...entry.extension, dagFileCount: fc }
	return entry
}

/**
 * 将默认频道消息重放进内存 chatLog。若 DAG 无消息则保留已有 chatLog（向后兼容旧 JSON 格式）。
 * @param {string} username
 * @param {string} chatid
 * @param {chatMetadata_t} chatMetadata
 */
async function hydrateChatLogFromDag(username, chatid, chatMetadata) {
	const defaultChannelId = await getDefaultChannelId(username, chatid)
	const lines = await listChannelMessages(username, chatid, defaultChannelId, { limit: 500 })
	const prelude = chatMetadata.chatLog.filter(e => e.timeSlice?.greeting_type)
	const deleted = new Set()
	/** @type {Map<string, { text?: string, fileCount?: number, _ts: number }>} */
	const edits = new Map()
	for (const line of lines) {
		if (line.type === 'message_delete' && line.content?.chatLogEntryId)
			deleted.add(line.content.chatLogEntryId)
		if (line.type === 'message_edit' && line.content?.chatLogEntryId) {
			const id = line.content.chatLogEntryId
			const ts = Number(line.timestamp) || 0
			const prev = edits.get(id)
			if (!prev || ts >= prev._ts)
				edits.set(id, { text: line.content.text, fileCount: line.content.fileCount, _ts: ts })
		}
	}
	const dagEntries = []
	for (const line of lines) {
		if (line.type !== 'message') continue
		const cid = line.content?.chatLogEntryId
		if (!cid || deleted.has(cid)) continue
		const ov = edits.get(cid)
		dagEntries.push(buildChatLogEntryFromDagMessage(line, chatMetadata.LastTimeSlice, ov))
	}

	// 若 DAG 无消息数据，保留原有 chatLog（向后兼容旧 JSON 格式聊天记录）
	if (dagEntries.length === 0 && prelude.length === 0) return

	chatMetadata.chatLog = [...prelude, ...dagEntries].sort((a, b) =>
		new Date(a.time_stamp).getTime() - new Date(b.time_stamp).getTime())
	chatMetadata.timeLines = chatMetadata.chatLog.length
		? [chatMetadata.chatLog[chatMetadata.chatLog.length - 1]]
		: []
	chatMetadata.timeLineIndex = 0
	if (chatMetadata.chatLog.length)
		chatMetadata.LastTimeSlice = chatMetadata.chatLog[chatMetadata.chatLog.length - 1].timeSlice
}

/**
 * 将指定聊天的元数据保存到磁盘。
 * @param {string} chatid - 要保存的聊天ID。
 */
export async function saveChat(chatid) {
	const chatData = chatMetadatas.get(chatid)
	if (!chatData || !chatData.chatMetadata) return

	const { username, chatMetadata } = chatData
	const chatDir = getUserDictionary(username) + '/shells/chat/chats'
	fs.mkdirSync(chatDir, { recursive: true })
	saveJsonFile(chatDir + '/' + chatid + '.json', await chatMetadata.toData())
	await updateChatSummary(chatid, chatMetadata)
}

/**
 * 从内存缓存或磁盘加载指定聊天的元数据。
 * @param {string} chatid - 要加载的聊天ID。
 * @returns {Promise<chatMetadata_t | undefined>}
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
	const { username } = chatData
	await ensureChat(username, chatid)
	if (chatData.chatMetadata._needsDagHydration) {
		await hydrateChatLogFromDag(username, chatid, chatData.chatMetadata)
		delete chatData.chatMetadata._needsDagHydration
	}
	return chatData.chatMetadata
}

function is_VividChat(chatMetadata) {
	return chatMetadata?.chatLog?.filter?.(entry => !entry.timeSlice?.greeting_type)?.length
}

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

	/** @type {import('../../../../../../decl/chatLog.ts').chatReplyRequest_t} */
	const result = {
		supported_functions: {
			markdown: true,
			mathjax: true,
			html: true,
			unsafe_html: true,
			files: true,
			add_message: true,
			fount_assets: true,
			fount_i18nkeys: true,
			fount_themes: true,
		},
		chat_name: 'common_chat_' + chatid,
		char_id: charname,
		username,
		UserCharname,
		Charname: charinfo.name || charname,
		locales,
		chat_log: chatMetadata.chatLog,
		timelines: chatMetadata.timeLines,
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
		plugins: timeSlice.plugins,
		extension: {},
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
	}
	else {
		timeSlice.player = await loadPart(username, `personas/${personaname}`)
		timeSlice.player_id = personaname
	}

	if (is_VividChat(chatMetadata)) saveChat(chatid)
	broadcastChatEvent(chatid, { type: 'persona_set', payload: { personaname } })
}

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
	const world = timeSlice.world = await loadPart(username, `worlds/${worldname}`)
	timeSlice.world_id = worldname
	if (world.interfaces.chat.GetGreeting && !chatLog.length)
		timeSlice.greeting_type = 'world_single'
	else if (world.interfaces.chat.GetGroupGreeting && chatLog.length)
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
		if (!result) return

		const greeting_entry = await BuildChatLogEntryFromCharReply(result, timeSlice, null, undefined, username)
		await addChatLogEntry(chatid, greeting_entry)
		return greeting_entry
	}
	catch {
		chatMetadata.LastTimeSlice.world = timeSlice.world
		chatMetadata.LastTimeSlice.world_id = timeSlice.world_id
	}

	if (is_VividChat(chatMetadata)) saveChat(chatid)
	return null
}

export async function addchar(chatid, charname) {
	const chatMetadata = await loadChat(chatid)
	if (!chatMetadata) throw new Error('Chat not found')

	const { username } = chatMetadata
	const timeSlice = chatMetadata.LastTimeSlice.copy()
	if (Object.keys(timeSlice.chars).length)
		timeSlice.greeting_type = 'group'
	else
		timeSlice.greeting_type = 'single'

	if (timeSlice.chars[charname]) return null

	const char = timeSlice.chars[charname] = await loadPart(username, `chars/${charname}`)
	broadcastChatEvent(chatid, { type: 'char_added', payload: { charname } })

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
		if (!result) return null

		const greeting_entry = await BuildChatLogEntryFromCharReply(result, timeSlice, char, charname, username)
		await addChatLogEntry(chatid, greeting_entry)
		return greeting_entry
	}
	catch (error) {
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
	broadcastChatEvent(chatid, { type: 'char_removed', payload: { charname } })
}

export async function addplugin(chatid, pluginname) {
	const chatMetadata = await loadChat(chatid)
	if (!chatMetadata) throw new Error('Chat not found')

	const { username } = chatMetadata
	const timeSlice = chatMetadata.LastTimeSlice.copy()

	if (timeSlice.plugins[pluginname]) return

	timeSlice.plugins[pluginname] = await loadPart(username, `plugins/${pluginname}`)
	broadcastChatEvent(chatid, { type: 'plugin_added', payload: { pluginname } })

	if (is_VividChat(chatMetadata)) saveChat(chatid)
}

export async function removeplugin(chatid, pluginname) {
	const chatMetadata = await loadChat(chatid)
	delete chatMetadata.LastTimeSlice.plugins[pluginname]
	if (is_VividChat(chatMetadata)) saveChat(chatid)
	broadcastChatEvent(chatid, { type: 'plugin_removed', payload: { pluginname } })
}

export async function setCharSpeakingFrequency(chatid, charname, frequency) {
	const chatMetadata = await loadChat(chatid)
	chatMetadata.LastTimeSlice.chars_speaking_frequency[charname] = frequency
	if (is_VividChat(chatMetadata)) saveChat(chatid)
	broadcastChatEvent(chatid, { type: 'char_frequency_set', payload: { charname, frequency } })
}

export async function getCharListOfChat(chatid) {
	const chatMetadata = await loadChat(chatid)
	return Object.keys(chatMetadata.LastTimeSlice.chars)
}

export async function getPluginListOfChat(chatid) {
	const chatMetadata = await loadChat(chatid)
	return Object.keys(chatMetadata.LastTimeSlice.plugins)
}

export async function GetChatLog(chatid, start, end) {
	const chatMetadata = await loadChat(chatid)
	return chatMetadata.chatLog.slice(start, end)
}

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

async function handleAutoReply(chatid, freq_data, initial_char, preferCharName) {
	if (preferCharName && freq_data.some(f => f.charname === preferCharName))
		try {
			await triggerCharReply(chatid, preferCharName)
			return
		}
		catch (error) {
			console.error(error)
		}

	let char = initial_char
	while (true) {
		freq_data = freq_data.filter(f => f.charname !== char)
		const nextreply = await getNextCharForReply(freq_data)
		if (nextreply) try {
			await triggerCharReply(chatid, nextreply)
			return
		} catch (error) {
			console.error(error)
			char = nextreply
		} else return
	}
}

function entryContentToMirrorText(entry) {
	const c = entry.content
	if (typeof c === 'string') return c
	if (c && typeof c === 'object') return JSON.stringify(c)
	return ''
}

function getChannelForCharStream(chatMetadata, placeholderEntry) {
	const idx = chatMetadata.chatLog.findIndex(e => e.id === placeholderEntry.id)
	for (let i = idx - 1; i >= 0; i--) {
		const e = chatMetadata.chatLog[i]
		if (e.role === 'user' && e.extension?.groupChannelId) {
			const g = String(e.extension.groupChannelId).trim()
			if (/^[\w.-]+$/.test(g) && g.length <= 128) return g
		}
	}
	return 'default'
}

async function syncChatLogEntryToDag(chatid, entry, username) {
	try {
		if (entry.is_generating) return
		if (entry.timeSlice?.greeting_type) return
		if (!username) return
		const text = entryContentToMirrorText(entry)
		const hasFiles = Array.isArray(entry.files) && entry.files.length > 0
		if (!text.trim() && !hasFiles) return
		await ensureChat(username, chatid)
		let ts = entry.time_stamp ? +new Date(entry.time_stamp) : Date.now()
		if (!Number.isFinite(ts)) ts = Date.now()
		let sender = 'user'
		if (entry.role === 'char')
			sender = entry.name || entry.timeSlice?.charname || 'char'
		else if (entry.role === 'user')
			sender = 'user'
		else
			sender = entry.name || entry.role || 'system'
		const content = {
			text: text.slice(0, 200_000),
			chatLogEntryId: entry.id,
			role: entry.role,
		}
		if (hasFiles) content.fileCount = entry.files.length
		const groupCh = entry.extension?.groupChannelId
		const channelIdForDag = typeof groupCh === 'string' && /^[\w.-]+$/.test(groupCh) && groupCh.length <= 128
			? groupCh
			: await getDefaultChannelId(username, chatid)
		await appendEvent(username, chatid, {
			type: 'message',
			channelId: channelIdForDag,
			sender,
			timestamp: ts,
			charId: entry.timeSlice?.charname,
			content,
		})
	}
	catch (e) {
		console.error(e)
	}
}

async function mirrorDeleteToDag(chatid, deletedEntry, username) {
	try {
		if (!deletedEntry?.id || !username) return
		if (deletedEntry.timeSlice?.greeting_type) return
		await ensureChat(username, chatid)
		await appendEvent(username, chatid, {
			type: 'message_delete',
			channelId: await getDefaultChannelId(username, chatid),
			sender: 'local',
			timestamp: Date.now(),
			content: { chatLogEntryId: deletedEntry.id },
		})
	}
	catch (e) {
		console.error(e)
	}
}

async function mirrorEditToDag(chatid, originalEntryId, entry, username) {
	try {
		if (!originalEntryId || !username) return
		if (entry.timeSlice?.greeting_type) return
		const text = entryContentToMirrorText(entry)
		const hasFiles = Array.isArray(entry.files) && entry.files.length > 0
		await ensureChat(username, chatid)
		const content = {
			chatLogEntryId: originalEntryId,
			text: text.slice(0, 200_000),
		}
		if (hasFiles) content.fileCount = entry.files.length
		await appendEvent(username, chatid, {
			type: 'message_edit',
			channelId: await getDefaultChannelId(username, chatid),
			sender: 'local',
			timestamp: Date.now(),
			content,
		})
	}
	catch (e) {
		console.error(e)
	}
}

async function mirrorFeedbackToDag(chatid, entry, feedback, username) {
	try {
		if (!entry?.id || !username) return
		if (entry.timeSlice?.greeting_type) return
		if (!feedback?.type) return
		await ensureChat(username, chatid)
		await appendEvent(username, chatid, {
			type: 'message_feedback',
			channelId: await getDefaultChannelId(username, chatid),
			sender: 'user',
			timestamp: Date.now(),
			content: {
				chatLogEntryId: entry.id,
				feedbackType: feedback.type,
				feedbackContent: feedback.content,
			},
		})
	}
	catch (e) {
		console.error(e)
	}
}

async function addChatLogEntry(chatid, entry) {
	const chatMetadata = await loadChat(chatid)
	if (entry.timeSlice.world?.interfaces?.chat?.AddChatLogEntry)
		await entry.timeSlice.world.interfaces.chat.AddChatLogEntry(await getChatRequest(chatid, undefined), entry)
	else
		chatMetadata.chatLog.push(entry)

	if (entry.role === 'char' && entry.timeSlice.charname) {
		const spokenChars = new Set(chatMetadata.chatLog.filter(e => e.role === 'char' && e.timeSlice.charname).map(e => e.timeSlice.charname))
		if (spokenChars.size >= 2) unlockAchievement(chatMetadata.username, 'shells/chat', 'multiplayer_chat')
	}

	chatMetadata.timeLines = [entry]
	chatMetadata.timeLineIndex = 0
	chatMetadata.LastTimeSlice = entry.timeSlice

	if (is_VividChat(chatMetadata)) saveChat(chatid)
	broadcastChatEvent(chatid, { type: 'message_added', payload: await entry.toData(chatMetadata.username) })

	const owner = chatMetadatas.get(chatid)?.username
	await syncChatLogEntryToDag(chatid, entry, owner)

	if (entry.role === 'char')
		sendNotification(chatMetadata.username, entry.name ?? 'Character', {
			body: entry.content,
			icon: entry.avatar || '/favicon.svg',
			data: {
				url: `/parts/shells:chat/#${chatid}`,
			},
		}, `/parts/shells:chat/#${chatid}`)

	const freq_data = await getCharReplyFrequency(chatid)
	let mentionTarget = null
	if (entry.role === 'user') {
		const c = entry.content
		const text = typeof c === 'string' ? c : (c && typeof c === 'object' ? c.text : '')
		if (typeof text === 'string') {
			const mm = text.match(/^@([\w.-]+)(?:\s|$)/u)
			if (mm?.[1] && chatMetadata.LastTimeSlice.chars[mm[1]])
				mentionTarget = mm[1]
		}
	}
	if (entry.timeSlice.world?.interfaces?.chat?.AfterAddChatLogEntry)
		await entry.timeSlice.world.interfaces.chat.AfterAddChatLogEntry(await getChatRequest(chatid, undefined), freq_data)
	else
		handleAutoReply(chatid, freq_data, entry.timeSlice.charname ?? null, mentionTarget)

	return entry
}

function replyPreviewText(reply) {
	if (!reply) return ''
	if (typeof reply.content === 'string') return reply.content
	if (reply.content_for_show != null) return String(reply.content_for_show)
	return ''
}

async function executeGeneration(chatid, request, stream, placeholderEntry, chatMetadata) {
	const entryId = placeholderEntry.id
	const channelForStream = getChannelForCharStream(chatMetadata, placeholderEntry)

	const finalizeEntry = async (finalEntry, isError = false) => {
		try {
			broadcastGroupEvent(chatid, {
				type: 'group_stream_end',
				channelId: channelForStream,
				pendingStreamId: entryId,
			})
			finishStreamBuffer(chatid, entryId)
		}
		catch { /* ignore */ }
		stream.done()
		finalEntry.id = entryId
		finalEntry.is_generating = false

		let idx = chatMetadata.chatLog.findIndex(e => e.id === entryId)
		if (idx === -1) {
			chatMetadata.chatLog.push(finalEntry)
			idx = chatMetadata.chatLog.length - 1
			chatMetadata.timeLines = [finalEntry]
			chatMetadata.timeLineIndex = 0
		}
		else {
			chatMetadata.chatLog[idx] = finalEntry
			const timelineIdx = chatMetadata.timeLines.findIndex(e => e.id === entryId)
			if (timelineIdx !== -1)
				chatMetadata.timeLines[timelineIdx] = finalEntry
		}

		chatMetadata.LastTimeSlice = finalEntry.timeSlice

		broadcastChatEvent(chatid, {
			type: 'message_replaced',
			payload: { index: idx, entry: await finalEntry.toData(chatMetadata.username) },
		})

		const owner = chatMetadatas.get(chatid)?.username
		if (!isError && !finalEntry.extension?.aborted)
			await syncChatLogEntryToDag(chatid, finalEntry, owner)

		if (!isError && is_VividChat(chatMetadata)) saveChat(chatid)
		return finalEntry
	}

	try {
		broadcastChatEvent(chatid, {
			type: 'stream_start',
			payload: { messageId: entryId },
		})
		try {
			broadcastGroupEvent(chatid, {
				type: 'group_stream_start',
				channelId: channelForStream,
				pendingStreamId: entryId,
				charId: request.char_id,
			})
		}
		catch { /* ignore */ }

		let prevVolatileText = ''
		let volatileChunkSeq = 0
		request.generation_options = {
			replyPreviewUpdater: reply => {
				stream.update(reply)
				const t = replyPreviewText(reply)
				const delta = t.slice(prevVolatileText.length)
				if (delta) {
					volatileChunkSeq++
					try {
						broadcastGroupEvent(chatid, {
							type: 'group_stream_chunk',
							channelId: channelForStream,
							pendingStreamId: entryId,
							chunkSeq: volatileChunkSeq,
							text: delta,
							charId: request.char_id,
						})
						bufferStreamChunk(chatid, entryId, volatileChunkSeq, delta)
					}
					catch { /* ignore */ }
					prevVolatileText = t
				}
			},
			signal: stream.signal,
			supported_functions: request.supported_functions,
		}

		const result = await request.char.interfaces.chat.GetReply(request)

		if (result === null) {
			stream.abort('Generation result was null.')
			try {
				broadcastGroupEvent(chatid, {
					type: 'group_stream_end',
					channelId: channelForStream,
					pendingStreamId: entryId,
				})
				finishStreamBuffer(chatid, entryId)
			}
			catch { /* ignore */ }
			const idx = chatMetadata.chatLog.findIndex(e => e.id === entryId)
			if (idx !== -1) await deleteMessage(chatid, idx)
			return
		}

		const finalEntry = await BuildChatLogEntryFromCharReply(
			result,
			placeholderEntry.timeSlice,
			request.char,
			request.char_id,
			chatMetadata.username,
		)

		const savedEntry = await finalizeEntry(finalEntry, false)

		const freq_data = await getCharReplyFrequency(chatid)
		if (savedEntry.timeSlice.world?.interfaces?.chat?.AfterAddChatLogEntry)
			await savedEntry.timeSlice.world.interfaces.chat.AfterAddChatLogEntry(await getChatRequest(chatid, undefined), freq_data)
		else
			await handleAutoReply(chatid, freq_data, savedEntry.timeSlice.charname ?? null)
	}
	catch (e) {
		if (e.name === 'AbortError') {
			placeholderEntry.is_generating = false
			placeholderEntry.extension = { ...placeholderEntry.extension, aborted: true }
			await finalizeEntry(placeholderEntry, false)
		}
		else {
			stream.abort(e?.message)

			function ErrorText(e) {
				if (e instanceof Error) return e.stack || e.message || inspect(e)
				if (Array.isArray(e)) return e.map(ErrorText).join('\n---\n')
				return inspect(e)
			}
			placeholderEntry.content = `\`\`\`\nError:\n${ErrorText(e)}\n\`\`\``
			await finalizeEntry(placeholderEntry, true)
		}
	}
	finally {
		updateTypingStatus(chatid, request.char_id, -1)
	}
}

export async function modifyTimeLine(chatid, delta) {
	StreamManager.abortAll(chatid)

	const chatMetadata = await loadChat(chatid)

	let newTimeLineIndex = chatMetadata.timeLineIndex + delta

	if (newTimeLineIndex < 0)
		newTimeLineIndex = chatMetadata.timeLines.length - 1

	let entry

	if (newTimeLineIndex >= chatMetadata.timeLines.length) {
		const previousEntry = chatMetadata.chatLog[chatMetadata.chatLog.length - 1]
		const { timeSlice } = previousEntry
		const { greeting_type } = timeSlice

		const newEntry = new chatLogEntry_t()
		newEntry.id = crypto.randomUUID()
		newEntry.timeSlice = timeSlice.copy()
		newEntry.timeSlice.greeting_type = greeting_type
		newEntry.timeSlice.charname = timeSlice.charname

		newEntry.role = previousEntry.role
		newEntry.name = previousEntry.name
		newEntry.avatar = previousEntry.avatar

		newEntry.is_generating = true
		newEntry.content = ''
		newEntry.files = []
		newEntry.time_stamp = new Date()

		chatMetadata.timeLines.push(newEntry)
		newTimeLineIndex = chatMetadata.timeLines.length - 1
		chatMetadata.timeLineIndex = newTimeLineIndex

		chatMetadata.chatLog[chatMetadata.chatLog.length - 1] = newEntry
		entry = newEntry

		broadcastChatEvent(chatid, {
			type: 'message_replaced',
			payload: { index: chatMetadata.chatLog.length - 1, entry: await newEntry.toData(chatMetadata.username) },
		})

		if (greeting_type)
			try {
				const { charname } = timeSlice
				const request = await getChatRequest(chatid, charname || undefined)
				let result

				const { world, chars } = timeSlice
				const char = charname ? chars[charname] : null

				switch (greeting_type) {
					case 'single':
						result = await char.interfaces.chat.GetGreeting(request, newTimeLineIndex)
						break
					case 'group':
						result = await char.interfaces.chat.GetGroupGreeting(request, newTimeLineIndex)
						break
					case 'world_single':
						result = await world.interfaces.chat.GetGreeting(request, newTimeLineIndex)
						break
					case 'world_group':
						result = await world.interfaces.chat.GetGroupGreeting(request, newTimeLineIndex)
						break
					default:
						if (char) result = await char.interfaces.chat.GetReply(request)
						break
				}

				if (!result) throw new Error('No greeting result')

				const newTimeSlice = timeSlice.copy()
				newTimeSlice.greeting_type = greeting_type

				let finalEntry
				if (greeting_type.startsWith('world_'))
					finalEntry = await BuildChatLogEntryFromCharReply(result, newTimeSlice, null, undefined, chatMetadata.username)
				else
					finalEntry = await BuildChatLogEntryFromCharReply(result, newTimeSlice, char, charname, chatMetadata.username)

				Object.assign(newEntry, finalEntry)
				newEntry.is_generating = false
				newEntry.id = entry.id

				chatMetadata.timeLines[newTimeLineIndex] = newEntry
				chatMetadata.chatLog[chatMetadata.chatLog.length - 1] = newEntry
				chatMetadata.LastTimeSlice = newEntry.timeSlice

				if (is_VividChat(chatMetadata)) saveChat(chatid)

				broadcastChatEvent(chatid, {
					type: 'message_replaced',
					payload: { index: chatMetadata.chatLog.length - 1, entry: await newEntry.toData(chatMetadata.username) },
				})
			} catch (e) {
				console.error('Greeting generation failed:', e)
				newEntry.content = `\`\`\`\nError generating greeting:\n${e.message}\n\`\`\``
				newEntry.is_generating = false
				newEntry.id = entry.id
				newEntry.timeSlice = timeSlice
				broadcastChatEvent(chatid, {
					type: 'message_replaced',
					payload: { index: chatMetadata.chatLog.length - 1, entry: await newEntry.toData(chatMetadata.username) },
				})
			}

		else {
			const { charname } = timeSlice
			const request = await getChatRequest(chatid, charname)
			const stream = StreamManager.create(chatid, newEntry.id)
			executeGeneration(chatid, request, stream, newEntry, chatMetadata)
		}
	} else {
		entry = chatMetadata.timeLines[newTimeLineIndex]
		chatMetadata.timeLineIndex = newTimeLineIndex
		chatMetadata.LastTimeSlice = entry.timeSlice
		chatMetadata.chatLog[chatMetadata.chatLog.length - 1] = entry

		if (is_VividChat(chatMetadata)) saveChat(chatid)

		broadcastChatEvent(chatid, {
			type: 'message_replaced',
			payload: { index: chatMetadata.chatLog.length - 1, entry: await entry.toData(chatMetadata.username) }
		})
	}

	return entry
}

async function BuildChatLogEntryFromCharReply(result, new_timeSlice, char, charname, username) {
	new_timeSlice.charname = charname
	const { info } = await getPartDetails(username, `chars/${charname}`) || {}

	const entry = new chatLogEntry_t()

	Object.assign(entry, {
		name: result.name || info?.name || charname || 'Unknown',
		avatar: result.avatar || info?.avatar,
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
	return entry
}

async function BuildChatLogEntryFromUserMessage(result, new_timeSlice, user, personaname, username) {
	new_timeSlice.playername = new_timeSlice.player_id
	const { info } = (personaname ? await getPartDetails(username, `personas/${personaname}`) : undefined) || {}
	const entry = new chatLogEntry_t()
	const ext = { ...(result.extension || {}) }
	if (typeof result.groupChannelId === 'string') {
		const g = result.groupChannelId.trim().slice(0, 128)
		if (g && /^[\w.-]+$/.test(g))
			ext.groupChannelId = g
	}
	Object.assign(entry, {
		name: result.name || info?.name || new_timeSlice.player_id || username,
		avatar: result.avatar || info?.avatar,
		content: result.content,
		timeSlice: new_timeSlice,
		role: 'user',
		time_stamp: new Date(),
		files: result.files || [],
		extension: ext
	})
	return entry
}

async function getCharReplyFrequency(chatid) {
	const chatMetadata = await loadChat(chatid)
	if (!chatMetadata) throw new Error('Chat not found')
	const result = [{ charname: null, frequency: 1 }]

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
	const all_freq = frequency_data.map(x => x.frequency).reduce((a, b) => a + b, 0)
	let random = Math.random() * all_freq

	for (const { charname, frequency } of frequency_data)
		if (random < frequency) return charname
		else random -= frequency
}

export async function triggerCharReply(chatid, charname) {
	const chatMetadata = await loadChat(chatid)
	if (!chatMetadata) throw new Error('Chat not found')

	if (!charname) {
		const frequency_data = (await getCharReplyFrequency(chatid)).filter(x => x.charname !== null)
		charname = await getNextCharForReply(frequency_data)
		if (!charname) return
	}
	const char = chatMetadata.LastTimeSlice.chars[charname]
	if (!char) throw new Error('char not found')

	const placeholder = new chatLogEntry_t()
	placeholder.role = 'char'
	placeholder.is_generating = true
	placeholder.timeSlice = chatMetadata.LastTimeSlice.copy()
	placeholder.time_stamp = new Date()
	const { info } = await getPartDetails(chatMetadata.username, `chars/${charname}`) || {}
	placeholder.name = info?.name || charname
	placeholder.avatar = info?.avatar
	placeholder.timeSlice.charname = charname
	placeholder.content = ''

	broadcastChatEvent(chatid, {
		type: 'message_added',
		payload: await placeholder.toData(chatMetadata.username),
	})

	const request = await getChatRequest(chatid, charname)
	const stream = StreamManager.create(chatid, placeholder.id)

	updateTypingStatus(chatid, charname, 1)

	executeGeneration(chatid, request, stream, placeholder, chatMetadata)
}

export async function addUserReply(chatid, object) {
	const chatMetadata = await loadChat(chatid)
	if (!chatMetadata) throw new Error('Chat not found')

	unlockAchievement(chatMetadata.username, 'shells/chat', 'first_chat')

	if (object.files?.some?.(file => file.mime_type.startsWith('image/')))
		unlockAchievement(chatMetadata.username, 'shells/chat', 'photo_chat')

	const timeSlice = chatMetadata.LastTimeSlice
	const new_timeSlice = timeSlice.copy()
	const user = timeSlice.player

	return addChatLogEntry(chatid, await BuildChatLogEntryFromUserMessage(object, new_timeSlice, user, new_timeSlice.player_id, chatMetadata.username))
}

async function loadChatSummary(username, chatid) {
	const filepath = getUserDictionary(username) + '/shells/chat/chats/' + chatid + '.json'
	if (!fs.existsSync(filepath)) return null

	try {
		const rawChatData = loadJsonFile(filepath)
		const chatLog = Array.isArray(rawChatData.chatLog) && rawChatData.chatLog.length > 0
			? rawChatData.chatLog
			: (Array.isArray(rawChatData.chatLogPrelude) ? rawChatData.chatLogPrelude : [])
		const lastEntry = chatLog[chatLog.length - 1]
		if (!lastEntry) return { chatid, chars: [], lastMessageSender: '', lastMessageSenderAvatar: null, lastMessageContent: '', lastMessageTime: new Date(0) }
		const chars = lastEntry.timeSlice?.chars || []
		return {
			chatid,
			chars,
			lastMessageSender: lastEntry.name || 'Unknown',
			lastMessageSenderAvatar: lastEntry.avatar || null,
			lastMessageContent: lastEntry.content || '',
			lastMessageTime: new Date(lastEntry.time_stamp),
		}
	}
	catch (error) {
		console.error(`Failed to load summary for chat ${chatid}:`, error)
		return null
	}
}

export async function getChatList(username) {
	const summariesCache = loadShellData(username, 'chat', 'chat_summaries_cache')

	await Promise.all(Array.from(chatMetadatas.entries()).map(async ([chatid, value]) => {
		if (value.username === username)
			summariesCache[chatid] ??= await loadChatSummary(username, chatid)
	}))

	const chatList = Object.values(summariesCache).filter(Boolean)
	return chatList.sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime))
}

export async function deleteChat(chatids, username) {
	const basedir = getUserDictionary(username) + '/shells/chat/chats/'
	const summariesCache = loadShellData(username, 'chat', 'chat_summaries_cache')
	const deletePromises = chatids.map(async chatid => {
		try {
			if (fs.existsSync(basedir + chatid + '.json')) await fs.promises.unlink(basedir + chatid + '.json')
			await deleteChatData(username, chatid)
			chatMetadatas.delete(chatid)
			delete summariesCache[chatid]
			return { chatid, success: true, message: 'Chat deleted successfully' }
		}
		catch (error) {
			console.error(`Error deleting chat ${chatid}:`, error)
			return { chatid, success: false, message: 'Error deleting chat', error: error.message }
		}
	})

	const results = await Promise.all(deletePromises)
	saveShellData(username, 'chat', 'chat_summaries_cache')
	return results
}

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

export async function deleteMessage(chatid, index) {
	const chatMetadata = await loadChat(chatid)
	if (!chatMetadata) throw new Error('Chat not found')
	if (!chatMetadata.chatLog[index]) throw new Error('Invalid index')

	const entry = chatMetadata.chatLog[index]
	if (entry)
		StreamManager.abortByMessageId(entry.id)

	function geneRequest() {
		return {
			index,
			chat_log: chatMetadata.chatLog,
			chat_entry: chatMetadata.chatLog[index],
		}
	}
	if (chatMetadata.LastTimeSlice.world?.interfaces?.chat?.MessageDelete)
		await chatMetadata.LastTimeSlice.world.interfaces.chat.MessageDelete(geneRequest())
	else {
		for (const char of Object.values(chatMetadata.LastTimeSlice.chars))
			await char.interfaces.chat?.MessageDelete?.(geneRequest())
		await chatMetadata.LastTimeSlice.player?.interfaces?.chat?.MessageDelete?.(geneRequest())
		chatMetadata.chatLog.splice(index, 1)
	}

	const last = chatMetadata.chatLog[chatMetadata.chatLog.length - 1]

	if (index == chatMetadata.chatLog.length) {
		chatMetadata.timeLines = [last].filter(Boolean)
		chatMetadata.timeLineIndex = 0
	}

	if (chatMetadata.chatLog.length)
		chatMetadata.LastTimeSlice = last.timeSlice
	else
		chatMetadata.LastTimeSlice = new timeSlice_t()

	if (is_VividChat(chatMetadata)) saveChat(chatid)
	broadcastChatEvent(chatid, { type: 'message_deleted', payload: { index } })

	const owner = chatMetadatas.get(chatid)?.username
	await mirrorDeleteToDag(chatid, entry, owner)
}

export async function editMessage(chatid, index, new_content) {
	const chatMetadata = await loadChat(chatid)
	if (!chatMetadata) throw new Error('Chat not found')
	if (!chatMetadata.chatLog[index]) throw new Error('Invalid index')

	const originalEntryId = chatMetadata.chatLog[index].id

	function geneRequest() {
		return {
			index,
			original: chatMetadata.chatLog[index],
			edited: new_content,
			chat_log: chatMetadata.chatLog,
		}
	}
	let editresult
	if (chatMetadata.LastTimeSlice.world?.interfaces?.chat?.MessageEdit)
		editresult = await chatMetadata.LastTimeSlice.world.interfaces.chat.MessageEdit(geneRequest())
	else {
		const entry = chatMetadata.chatLog[index]
		if (entry.timeSlice.charname) {
			const char = entry.timeSlice.chars[entry.timeSlice.charname]
			editresult = await char.interfaces.chat?.MessageEdit?.(geneRequest())
		}
		else if (entry.timeSlice.playername)
			editresult = await entry.timeSlice?.player?.interfaces?.chat?.MessageEdit?.(geneRequest())
		editresult ??= new_content

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
		entry = await BuildChatLogEntryFromUserMessage(editresult, timeSlice, timeSlice.player, timeSlice.player_id, chatMetadata.username)

	chatMetadata.chatLog[index] = entry
	if (index == chatMetadata.chatLog.length - 1)
		chatMetadata.timeLines[chatMetadata.timeLineIndex] = entry

	if (is_VividChat(chatMetadata)) saveChat(chatid)
	broadcastChatEvent(chatid, { type: 'message_edited', payload: { index, entry: await entry.toData(chatMetadata.username) } })

	const owner = chatMetadatas.get(chatid)?.username
	await mirrorEditToDag(chatid, originalEntryId, entry, owner)

	return entry
}

export async function setMessageFeedback(chatid, index, feedback) {
	const chatMetadata = await loadChat(chatid)
	if (!chatMetadata) throw new Error('Chat not found')
	if (!chatMetadata.chatLog[index]) throw new Error('Invalid index')
	const entry = chatMetadata.chatLog[index]
	entry.extension ??= {}
	entry.extension.feedback = feedback
	if (index === chatMetadata.chatLog.length - 1 && chatMetadata.timeLines[chatMetadata.timeLineIndex]?.id === entry.id)
		chatMetadata.timeLines[chatMetadata.timeLineIndex] = entry
	if (is_VividChat(chatMetadata)) saveChat(chatid)
	broadcastChatEvent(chatid, { type: 'message_replaced', payload: { index, entry: await entry.toData(chatMetadata.username) } })

	const owner = chatMetadatas.get(chatid)?.username
	await mirrorFeedbackToDag(chatid, entry, feedback, owner)

	return entry
}

export async function getInitialData(chatid) {
	const chatMetadata = await loadChat(chatid)
	if (!chatMetadata) throw skip_report(new Error('Chat not found'))
	const timeSlice = chatMetadata.LastTimeSlice
	return {
		charlist: Object.keys(timeSlice.chars),
		pluginlist: Object.keys(timeSlice.plugins),
		worldname: timeSlice.world_id,
		personaname: timeSlice.player_id,
		frequency_data: timeSlice.chars_speaking_frequency,
		logLength: chatMetadata.chatLog.length,
		initialLog: await Promise.all(chatMetadata.chatLog.slice(-20).map(x => x.toData(chatMetadata.username))),
	}
}

events.on('AfterUserDeleted', async payload => {
	const { username } = payload
	const chatIdsToDeleteFromCache = []
	for (const [chatId, data] of chatMetadatas.entries())
		if (data.username === username)
			chatIdsToDeleteFromCache.push(chatId)
	chatIdsToDeleteFromCache.forEach(chatId => chatMetadatas.delete(chatId))
})

events.on('AfterUserRenamed', async ({ oldUsername, newUsername }) => {
	for (const [chatId, data] of chatMetadatas.entries())
		if (data.username === oldUsername) {
			data.username = newUsername
			if (data.chatMetadata && data.chatMetadata.username === oldUsername)
				data.chatMetadata.username = newUsername
			saveChat(chatId)
		}
})
