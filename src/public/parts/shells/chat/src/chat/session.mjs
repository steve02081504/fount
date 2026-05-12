/** @typedef {import('../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../../decl/userAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../../decl/pluginAPI.ts').PluginAPI_t} PluginAPI_t */
/** @typedef {import('../../../../../../decl/basedefs.ts').locale_t} locale_t */

import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import { inspect } from 'node:util'

import { geti18nForUser } from '../../../../../../scripts/i18n.mjs'
import { loadJsonFile, saveJsonFile } from '../../../../../../scripts/json_loader.mjs'
import { getPartInfo } from '../../../../../../scripts/locale.mjs'
import { ms } from '../../../../../../scripts/ms.mjs'
import { getUserByUsername, getAllUserNames } from '../../../../../../server/auth.mjs'
import { events } from '../../../../../../server/events.mjs'
import { getAllDefaultParts, getAnyDefaultPart, getPartDetails, loadPart } from '../../../../../../server/parts_loader.mjs'
import { skip_report } from '../../../../../../server/server.mjs'
import { loadShellData, saveShellData } from '../../../../../../server/setting_loader.mjs'
import { sendNotification } from '../../../../../../server/web_server/event_dispatcher.mjs'
import { unlockAchievement } from '../../../achievements/src/api.mjs'
import { deleteChat } from '../chat.mjs'
import { addfile, getfile } from '../files.mjs'
import { readChannelMessagesForUser } from '../group_endpoints.mjs'
import { generateDiff, createBufferedSyncPreviewUpdater } from '../stream.mjs'

import { deleteLogContextSidecar, gcLogContextSidecars, hydrateLogContextFromSidecar, persistLogContextSidecar } from './context_sidecar.mjs'
import { appendEvent, ensureChat, getDefaultChannelId, getState, isValidChannelId } from './dag.mjs'
import { syncChatLogEntryToDag, mirrorDeleteToDag, mirrorEditToDag } from './dagSync.mjs'
import { loadLocalMailboxDecryptContext } from './e2e_mailbox.mjs'
import { chatJsonPath, chatsRoot } from './paths.mjs'
import { createCharRpcDispatcher } from './rpcDispatcher.mjs'
import { deserializeMessageContent } from './visibility.mjs'
import { broadcastEvent as broadcastGroupEvent, bufferStreamChunk, finishStreamBuffer } from './websocket.mjs'

/**
 * 部件路径缺失或模块未找到时忽略；其余错误继续抛出。
 * @param {unknown} e 捕获值
 * @returns {void}
 */
function ignoreMissingPartLoadError(e) {
	if (e?.code === 'ENOENT' || e?.code === 'ERR_MODULE_NOT_FOUND' || e?.code === 'MODULE_NOT_FOUND')
		return
	const c = e?.cause
	if (c && (c.code === 'ENOENT' || c.code === 'ERR_MODULE_NOT_FOUND' || c.code === 'MODULE_NOT_FOUND'))
		return
	throw e
}

const activeStreams = new Map()
const StreamManager = {
	/**
	 * 创建流式生成任务。
	 * @param {string} groupId - 聊天ID。
	 * @param {string} messageId - 消息的唯一ID，绑定到消息UUID。
	 * @returns {{id: string, signal: AbortSignal, update: Function, done: Function, abort: Function}} - 流式生成任务的控制对象。
	 */
	create(groupId, messageId) {
		const streamId = crypto.randomUUID()
		const controller = new AbortController()

		const context = {
			groupId,
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
				broadcastChatEvent(groupId, {
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
	 * @param {string} groupId - 要中止流式生成任务的聊天ID。
	 */
	abortAll(groupId) {
		for (const [id, ctx] of activeStreams)
			if (ctx.groupId === groupId) {
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
const typingStatus = new Map()
const chatDeleteTimers = new Map()
const CHAT_UNLOAD_TIMEOUT = ms('30m')

/**
 * 更新并广播输入状态（通过群组统一 WS 发出）。
 * @param {string} groupId - 群组ID。
 * @param {string} charname - 角色名称。
 * @param {number} delta - 变化量 (+1 或 -1)。
 */
function updateTypingStatus(groupId, charname, delta) {
	if (!typingStatus.has(groupId)) typingStatus.set(groupId, new Map())
	const chatMap = typingStatus.get(groupId)
	const current = chatMap.get(charname) || 0
	const next = current + delta
	if (next <= 0) chatMap.delete(charname)
	else chatMap.set(charname, next)

	const typingList = Array.from(chatMap.keys())
	broadcastGroupEvent(groupId, { type: 'typing_status', payload: { typingList } })
}

/**
 * 当群组所有 WS 连接断开时调用，触发聊天数据清理流程。
 * 由 endpoints.mjs 的 WS close 处理器调用。
 * @param {string} groupId 群组 ID
 * @returns {void}
 */
export function onGroupWsClose(groupId) {
	const chatData = chatMetadatas.get(groupId)
	if (!chatData) return
	StreamManager.abortAll(groupId)
	clearTimeout(chatDeleteTimers.get(groupId))
	chatDeleteTimers.set(groupId, setTimeout(async () => {
		try {
			if (!chatData) return
			if (is_VividChat(chatData.chatMetadata)) {
				await saveChat(groupId)
				chatData.chatMetadata = null
			}
			else await deleteChat([groupId], chatData.username)
		}
		finally {
			chatDeleteTimers.delete(groupId)
		}
	}, CHAT_UNLOAD_TIMEOUT))
}

/**
 * 按 messageId 中止流式生成（供 WS handler 调用）
 * @param {string} messageId 流式消息绑定的 UUID
 * @returns {void}
 */
export function abortStreamByMessageId(messageId) {
	StreamManager.abortByMessageId(messageId)
}

/**
 * 广播聊天会话事件，通过统一群组 WS 发出。
 * @param {string} groupId - 群组ID。
 * @param {object} event - 要广播的事件。
 */
function broadcastChatEvent(groupId, event) {
	broadcastGroupEvent(groupId, event)
}

/**
 * 启动时扫描用户目录，将已有聊天 JSON 登记到内存映射（元数据懒加载）。
 * @returns {void}
 */
function initializeChatMetadatas() {
	const users = getAllUserNames()
	for (const user of users) {
		const userDir = chatsRoot(user)
		if (fs.existsSync(userDir)) {
			const chatFiles = fs.readdirSync(userDir).filter(file => file.endsWith('.json'))
			for (const file of chatFiles) {
				const groupId = file.replace('.json', '')
				if (!chatMetadatas.has(groupId))
					chatMetadatas.set(groupId, { username: user, chatMetadata: null })
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

	/**
	 * 深拷贝时间切片（角色名等瞬态字段会重置）。
	 * @returns {timeSlice_t} 新的时间切片实例
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
	 * 序列化为可 JSON 持久化的精简结构（仅存 ID 引用）。
	 * @returns {object} 纯数据对象
	 */
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

	/**
	 * 导出与 toJSON 类似的数据形状（异步占位，便于与条目 toData 对齐）。
	 * @returns {Promise<object>} 数据对象
	 */
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

	/**
	 * 从持久化 JSON 恢复时间切片并加载角色/插件/世界/人格部件。
	 * @param {object} json 序列化对象
	 * @param {string} username 所属用户
	 * @returns {Promise<timeSlice_t>} 还原后的实例
	 */
	static async fromJSON(json, username) {
		return Object.assign(new timeSlice_t(), {
			...json,
			chars: Object.fromEntries(await Promise.all(
				(json.chars || []).map(async charname => [charname, await loadPart(username, 'chars/' + charname).catch(e => { ignoreMissingPartLoadError(e) })])
			)),
			plugins: Object.fromEntries(await Promise.all(
				(json.plugins || []).map(async plugin => [plugin, await loadPart(username, 'plugins/' + plugin).catch(e => { ignoreMissingPartLoadError(e) })])
			)),
			world_id: json.world,
			world: json.world ? await loadPart(username, 'worlds/' + json.world).catch(e => { ignoreMissingPartLoadError(e) }) : undefined,
			player_id: json.player,
			player: json.player ? await loadPart(username, 'personas/' + json.player).catch(e => { ignoreMissingPartLoadError(e) }) : undefined,
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

	/**
	 * 创建空聊天日志条目并分配新 UUID。
	 * @returns {void}
	 */
	constructor() {
		this.id = crypto.randomUUID()
	}

	/**
	 * 序列化条目（文件 buffer 转为 base64）。
	 * @returns {object} 可写入 JSON 的对象
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
	 * 导出条目数据并将文件落盘为 file: 引用。
	 * @param {string} username 所属用户
	 * @returns {Promise<object>} 数据对象
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
	 * 从 JSON 恢复聊天日志条目（含时间切片与文件）。
	 * @param {object} json 序列化对象
	 * @param {string} username 所属用户
	 * @returns {Promise<chatLogEntry_t>} 条目实例
	 */
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
 * 描述一个完整聊天的元数据。每个聊天天然对应一个 DAG 群组（groupId === groupId）。
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

	/**
	 * 构造聊天元数据容器并绑定用户名。
	 * @param {string} username 聊天所有者
	 * @returns {void}
	 */
	constructor(username) {
		this.username = username
	}

	/**
	 * 创建带默认人格、世界与插件的新聊天元数据。
	 * @param {string} username 聊天所有者
	 * @returns {Promise<chatMetadata_t>} 新元数据实例
	 */
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

	/**
	 * 导出精简持久化视图（正文 chatLog 由 DAG 承载时为空数组）。
	 * @returns {object} 可写入磁盘的 JSON 形状
	 */
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

	/**
	 * 异步导出磁盘存储格式（含 prelude 条目 toData）。
	 * @returns {Promise<object>} 持久化数据对象
	 */
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

	/**
	 * 从磁盘 JSON 恢复元数据（兼容旧版全量 chatLog 与新 DAG 迁移格式）。
	 * @param {object} json 持久化对象
	 * @returns {Promise<chatMetadata_t>} 元数据实例
	 */
	static async fromJSON(json) {
		const rawChatLog = Array.isArray(json.chatLog) ? json.chatLog : []

		// 向后兼容：旧格式 chatLog 不为空则直接加载（未迁移到 DAG 存储的旧聊天）
		let chatLog
		let needsHydration = false
		if (rawChatLog.length === 0) {
			chatLog = await Promise.all((json.chatLogPrelude || []).map(data => chatLogEntry_t.fromJSON(data, json.username)))
			needsHydration = true
		}
		else 
			chatLog = await Promise.all(rawChatLog.map(data => chatLogEntry_t.fromJSON(data, json.username)))
		

		const timeLines = rawChatLog.length === 0
			? []
			: await Promise.all((json.timeLines || []).map(entry => chatLogEntry_t.fromJSON(entry, json.username)))

		for (const entry of chatLog)
			if (entry.is_generating) entry.is_generating = false

		for (const entry of timeLines)
			if (entry.is_generating) entry.is_generating = false

		let LastTimeSlice
		if (rawChatLog.length === 0) 
			LastTimeSlice = json.persistedTimeSlice
				? await timeSlice_t.fromJSON(json.persistedTimeSlice, json.username)
				: chatLog.length ? chatLog[chatLog.length - 1].timeSlice : new timeSlice_t()
		
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

	/**
	 * 通过 toJSON/fromJSON 路径克隆当前聊天元数据。
	 * @returns {Promise<chatMetadata_t>} 克隆后的实例
	 */
	copy() {
		return chatMetadata_t.fromJSON(this.toJSON())
	}
}

/**
 * 为指定的聊天ID创建一个新的、空的元数据实例。
 * @param {string} groupId - 聊天ID。
 * @param {string} username - 聊天的所有者用户名。
 * @returns {Promise<void>}
 */
export async function newMetadata(groupId, username) {
	chatMetadatas.set(groupId, { username, chatMetadata: await chatMetadata_t.StartNewAs(username) })
}

/**
 * 生成不与内存冲突的随机聊天 ID。
 * @returns {string} 可用 groupId
 */
export function findEmptyGroupId() {
	while (true) {
		const uuid = Math.random().toString(36).substring(2, 15)
		if (!chatMetadatas.has(uuid)) return uuid
	}
}

/**
 * 创建一个全新的聊天（每个聊天天然对应一个群，groupId === groupId）。
 * @param {string} username - 新聊天的所有者用户名。
 * @param {{ name?: string, defaultChannelName?: string }} [options] 可选：群显示名与默认频道名
 * @returns {Promise<string>} 新创建的聊天的ID。
 */
export async function newChat(username, options = {}) {
	const groupId = findEmptyGroupId()
	await newMetadata(groupId, username)
	await ensureChat(username, groupId, {
		name: options.name || '聊天',
		defaultChannelName: options.defaultChannelName,
	})
	return groupId
}

/**
 * 单一入口：按声明创建聊天会话（DM/群聊共用底层 newChat + ensureChat）。
 * @param {{ username: string, name?: string, defaultChannelName?: string }} spec - 所有者用户名与可选展示名、默认频道名
 * @returns {Promise<string>} groupId
 */
export async function createChatSessionFromSpec(spec) {
	const { username, ...options } = spec
	return newChat(username, options)
}

/**
 * 从内存元数据构造聊天列表摘要条目（非活跃聊天返回 null）。
 * @param {string} groupId 聊天 ID
 * @param {chatMetadata_t} chatMetadata 元数据实例
 * @returns {object | null} 摘要对象或 null
 */
function getSummaryFromMetadata(groupId, chatMetadata) {
	if (!is_VividChat(chatMetadata)) return null
	const lastEntry = chatMetadata.chatLog[chatMetadata.chatLog.length - 1]
	if (!lastEntry) return null
	return {
		groupId,
		chars: Object.keys(chatMetadata.LastTimeSlice.chars),
		lastMessageSender: lastEntry.name,
		lastMessageSenderAvatar: lastEntry.avatar || null,
		lastMessageContent: lastEntry.content,
		lastMessageTime: lastEntry.time_stamp,
	}
}

/**
 * 更新 shellData 中的聊天摘要缓存并落盘。
 * @param {string} groupId 聊天 ID
 * @param {chatMetadata_t} [chatMetadata] 元数据；可省略以从磁盘加载
 * @returns {Promise<void>}
 */
async function updateChatSummary(groupId, chatMetadata) {
	const { username } = chatMetadatas.get(groupId)

	if (!chatMetadata) chatMetadata = await loadChat(groupId)

	const summary = getSummaryFromMetadata(groupId, chatMetadata)
	const summariesCache = loadShellData(username, 'chat', 'chat_summaries_cache')
	if (summary) summariesCache[groupId] = summary
	else delete summariesCache[groupId]

	saveShellData(username, 'chat', 'chat_summaries_cache')
}

/**
 * 按侧车可达性根（元数据 + messages 索引 + events + 当前内存 chatLog）对齐各频道 context sidecar。
 * @param {string} username 所有者
 * @param {string} groupId 群 ID
 * @param {chatLogEntry_t[]} chatLog 当前内存中的日志条目
 * @returns {Promise<void>}
 */
async function reconcileContextSidecarsWithChatLog(username, groupId, chatLog) {
	if (!username || !groupId || !Array.isArray(chatLog)) return
	await gcLogContextSidecars(username, groupId, { chatLog })
}

/**
 * 解析 DAG 消息正文；若为 mailbox-ecdh 载荷且本机有种子则尝试解密。
 * @param {object | undefined} content DAG content
 * @param {{ myPubKeyHash: string, mySecretKeyBytes: Uint8Array } | null} decryptContext 本机解密上下文
 * @param {string} decryptUnavailableText 解密失败时的占位文本
 * @param {string} [contentRefPlaceholder] content_ref 展示用占位（i18n）
 * @param {string} [contentRefMismatchText] content_ref 哈希不一致提示
 * @returns {string} 可展示正文
 */
function resolveDagMessageText(content, decryptContext, decryptUnavailableText, contentRefPlaceholder, contentRefMismatchText) {
	if (content?._contentRefHashMismatch)
		return (contentRefMismatchText && String(contentRefMismatchText).trim()) || 'content_ref mismatch'
	const ref = content?.content_ref
	if (ref && typeof ref === 'object') {
		const h = typeof ref.contentHash === 'string' ? ref.contentHash.trim().slice(0, 12) : ''
		return (contentRefPlaceholder && String(contentRefPlaceholder).trim())
			|| `[content_ref:${h || '?'}…]`
	}
	const e2e = content?.e2e
	if (!e2e || e2e.encrypted !== true)
		return content?.text ?? e2e?.content ?? ''
	if (e2e.pending === true)
		return decryptUnavailableText
	if (!decryptContext)
		return decryptUnavailableText
	return deserializeMessageContent(e2e, decryptContext) ?? decryptUnavailableText
}

/**
 * 从 DAG default 频道行构造 chatLog 条目。
 * @param {object} line DAG 消息事件行
 * @param {timeSlice_t} baseSlice 作为快照基准的时间切片
 * @param {{ text?: string, fileCount?: number } | undefined} editOverride 编辑折叠后的覆盖字段
 * @param {{ myPubKeyHash: string, mySecretKeyBytes: Uint8Array } | null} decryptContext 本机解密上下文
 * @param {string} decryptUnavailableText 解密失败时的占位文本
 * @param {string} [contentRefPlaceholder] content_ref 占位文案
 * @param {string} [contentRefMismatchText] content_ref 校验失败文案
 * @returns {Promise<chatLogEntry_t>} 新构造的日志条目
 */
async function buildChatLogEntryFromDagMessage(
	line,
	baseSlice,
	editOverride,
	decryptContext,
	decryptUnavailableText,
	contentRefPlaceholder,
	contentRefMismatchText,
) {
	const c = line.content || {}
	const entry = new chatLogEntry_t()
	entry.id = c.chatLogEntryId || line.eventId
	const text = editOverride?.text != null
		? editOverride.text
		: resolveDagMessageText(c, decryptContext, decryptUnavailableText, contentRefPlaceholder, contentRefMismatchText)
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
	if (c.visibility) entry.visibility = c.visibility
	if (c.charVisibility?.length) entry.charVisibility = c.charVisibility
	return entry
}

/**
 * 将默认频道消息重放进内存 chatLog。若 DAG 无消息则保留已有 chatLog（向后兼容旧 JSON 格式）。
 * @param {string} username 用户名
 * @param {string} groupId 聊天 ID
 * @param {chatMetadata_t} chatMetadata 要写入的元数据引用
 * @returns {Promise<void>}
 */
async function hydrateChatLogFromDag(username, groupId, chatMetadata) {
	const defaultChannelId = await getDefaultChannelId(username, groupId)
	const lines = await readChannelMessagesForUser(username, groupId, defaultChannelId, { limit: 500 })
	const decryptContext = await loadLocalMailboxDecryptContext(username, groupId)
	const decryptUnavailableText = await geti18nForUser(username, 'chat.group.e2eDecryptUnavailable')
		.catch(() => undefined) || '消息已加密，当前设备无法解密'
	const contentRefPlaceholder = await geti18nForUser(username, 'chat.group.contentRefBodyPending')
		.catch(() => undefined) || ''
	const contentRefMismatchText = await geti18nForUser(username, 'chat.group.contentRefHashMismatch')
		.catch(() => undefined) || ''
	const streamTruncNote = await geti18nForUser(username, 'chat.group.logicalStreamTruncated')
		.catch(() => undefined) || ''
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
				edits.set(id, {
					text: resolveDagMessageText(line.content, decryptContext, decryptUnavailableText, contentRefPlaceholder, contentRefMismatchText),
					fileCount: line.content.fileCount,
					_ts: ts,
				})
		}
	}
	const dagEntries = []
	for (const line of lines) {
		if (line.type !== 'message') continue
		const cid = line.content?.chatLogEntryId
		if (!cid || deleted.has(cid)) continue
		const ov = edits.get(cid)
		const entry = await buildChatLogEntryFromDagMessage(
			line,
			chatMetadata.LastTimeSlice,
			ov,
			decryptContext,
			decryptUnavailableText,
			contentRefPlaceholder,
			contentRefMismatchText,
		)
		if (line.content?._logicalStreamTruncated && streamTruncNote)
			entry.content = `${entry.content}\n[${streamTruncNote}]`

		dagEntries.push(entry)
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

	await reconcileContextSidecarsWithChatLog(username, groupId, chatMetadata.chatLog)
}

/**
 * 将指定聊天的元数据保存到磁盘。
 * @param {string} groupId - 要保存的聊天ID。
 * @returns {Promise<void>}
 */
export async function saveChat(groupId) {
	const chatData = chatMetadatas.get(groupId)
	if (!chatData || !chatData.chatMetadata) return

	const { username, chatMetadata } = chatData
	const dir = chatsRoot(username)
	fs.mkdirSync(dir, { recursive: true })
	saveJsonFile(chatJsonPath(username, groupId), await chatMetadata.toData())
	await updateChatSummary(groupId, chatMetadata)
}

/**
 * 从内存缓存或磁盘加载指定聊天的元数据。
 * @param {string} groupId - 要加载的聊天ID。
 * @returns {Promise<chatMetadata_t | undefined>} 元数据；不存在时 undefined
 */
export async function loadChat(groupId) {
	const chatData = chatMetadatas.get(groupId)
	if (!chatData) return undefined

	if (!chatData.chatMetadata) {
		const { username } = chatData
		const filepath = chatJsonPath(username, groupId)
		if (!fs.existsSync(filepath)) return undefined
		chatData.chatMetadata = await chatMetadata_t.fromJSON(loadJsonFile(filepath))
		chatMetadatas.set(groupId, chatData)
	}
	const { username } = chatData
	await ensureChat(username, groupId)
	if (chatData.chatMetadata._needsDagHydration) {
		await hydrateChatLogFromDag(username, groupId, chatData.chatMetadata)
		delete chatData.chatMetadata._needsDagHydration
	}
	return chatData.chatMetadata
}

/**
 * 判断聊天是否已有非问候类的实质消息（用于决定是否持久化等）。
 * @param {chatMetadata_t} chatMetadata 元数据
 * @returns {number|undefined} 非问候消息条数；无 chatLog 时为假值
 */
function is_VividChat(chatMetadata) {
	return chatMetadata?.chatLog?.filter?.(entry => !entry.timeSlice?.greeting_type)?.length
}

/**
 * 构造 CharAPI 侧发起回复/问候所需的 chatReplyRequest 上下文。
 * @param {string} groupId 聊天 ID
 * @param {string | undefined} charname 当前聚焦角色名；可 undefined 表示世界线等
 * @param {string | null} [channelId] 当前 chat 频道；null 时从最近用户消息或默认频道推断
 * @returns {Promise<object>} chatReplyRequest 形状的对象
 */
async function getChatRequest(groupId, charname, channelId = null) {
	const chatMetadata = await loadChat(groupId)
	if (!chatMetadata) throw new Error('Chat not found')

	const { username, LastTimeSlice: timeSlice } = chatMetadata
	const { locales } = getUserByUsername(username)
	const userinfo = await getPartInfo(timeSlice.player, locales) || {}
	const charinfo = charname ? await getPartInfo(timeSlice.chars[charname], locales) || {} : {}
	const UserCharname = userinfo.name || timeSlice.player_id || username

	const other_chars = { ...timeSlice.chars }
	if (charname)
		delete other_chars[charname]

	let effectiveChannelId = channelId
	if (!effectiveChannelId) 
		for (let i = chatMetadata.chatLog.length - 1; i >= 0; i--) {
			const e = chatMetadata.chatLog[i]
			const g = e.extension?.groupChannelId
			if (isValidChannelId(g)) {
				effectiveChannelId = g
				break
			}
		}
	
	if (!effectiveChannelId)
		effectiveChannelId = await getDefaultChannelId(username, groupId).catch(() => 'default')

	const worldName = await GetWorldName(groupId, effectiveChannelId)
	/** @type {import('../../../../../../decl/worldAPI.ts').WorldAPI_t | undefined} */
	let channelWorld
	if (worldName)
		channelWorld = await loadPart(username, `worlds/${worldName}`).catch(() => undefined)

	const resolvedWorld = channelWorld ?? timeSlice.world

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
		chat_name: 'common_chat_' + groupId,
		char_id: charname,
		username,
		UserCharname,
		Charname: charname ? charinfo.name || charname : '',
		locales,
		chat_log: chatMetadata.chatLog,
		timelines: chatMetadata.timeLines,
		member_roles: [],
		/**
		 * 重新拉取最新的 chatReplyRequest（角色列表等可能已变）。
		 * @returns {Promise<object>} 新的请求上下文
		 */
		Update: () => getChatRequest(groupId, charname, channelId),
		/**
		 * 由角色侧向当前聊天追加一条日志条目。
		 * @param {object} entry 角色回复结果对象
		 * @returns {Promise<chatLogEntry_t>} 写入后的条目
		 */
		AddChatLogEntry: async entry => {
			if (!charname || !chatMetadata.LastTimeSlice.chars[charname]) throw new Error('Char not in this chat')
			return addChatLogEntry(groupId, await BuildChatLogEntryFromCharReply(
				entry,
				chatMetadata.LastTimeSlice.copy(),
				chatMetadata.LastTimeSlice.chars[charname],
				charname,
				chatMetadata.username
			))
		},
		world: resolvedWorld,
		char: charname ? timeSlice.chars[charname] : undefined,
		user: timeSlice.player,
		other_chars,
		chat_scoped_char_memory: charname ? timeSlice.chars_memories[charname] ??= {} : {},
		plugins: timeSlice.plugins,
		extension: {
			groupId,
			channelId: effectiveChannelId,
			memberId: charname ? `${username}:${charname}` : username,
			member_roles: [],
		},
	}

	for (const logEntry of result.chat_log) {
		const ch = isValidChannelId(logEntry.extension?.groupChannelId)
			? logEntry.extension.groupChannelId
			: effectiveChannelId
		await hydrateLogContextFromSidecar(username, groupId, ch, logEntry)
	}

	if (resolvedWorld?.interfaces?.chat?.GetChatLogForCharname && charname)
		result.chat_log = await resolvedWorld.interfaces.chat.GetChatLogForCharname(result, charname)

	if (charname && timeSlice.chars[charname]) {
		const charPart = timeSlice.chars[charname]
		let dagCap
		try {
			const { state } = await getState(username, groupId)
			const targetMid = `${username}:${charname}`
			for (const m of state.members.values()) {
				const mid = m.profile?.memberId ?? m.memberId
				if (mid === targetMid || mid === charname) {
					const cl = m.profile?.contextLength
					const n0 = Number(cl)
					if (Number.isFinite(n0) && n0 > 0) {
						dagCap = n0
						break
					}
				}
			}
		}
		catch (e) {
			console.error('getState for context length cap failed:', e)
		}
		const cap = dagCap ?? charPart.contextLength ?? charPart.extension?.contextLength
		const n = Number(cap)
		if (Number.isFinite(n) && n > 0 && result.chat_log.length > n)
			result.chat_log = result.chat_log.slice(-n)
	}

	return result
}

/**
 * 设置当前聊天使用的人格并广播 persona_set。
 * @param {string} groupId 聊天 ID
 * @param {string} [personaname] 人格名；空则清除
 * @returns {Promise<void>}
 */
export async function setPersona(groupId, personaname) {
	const chatMetadata = await loadChat(groupId)
	const { LastTimeSlice: timeSlice, username } = chatMetadata
	if (!personaname) {
		timeSlice.player = undefined
		timeSlice.player_id = undefined
	}
	else {
		timeSlice.player = await loadPart(username, `personas/${personaname}`)
		timeSlice.player_id = personaname
	}

	if (is_VividChat(chatMetadata)) saveChat(groupId)
	broadcastChatEvent(groupId, { type: 'persona_set', payload: { personaname } })
}

/**
 * 设置指定频道的世界书，并可能插入世界问候消息。
 * @param {string} groupId 群组 ID（同 groupId）
 * @param {string} channelId 频道 ID
 * @param {string | null} worldname 世界名；空则清除该频道世界
 * @returns {Promise<chatLogEntry_t | null>} 问候条目或 null
 */
export async function setWorld(groupId, channelId, worldname) {
	channelId = channelId ?? 'default'
	const chatMetadata = await loadChat(groupId)
	if (!chatMetadata.channelWorlds) chatMetadata.channelWorlds = new Map()

	if (!worldname) {
		chatMetadata.channelWorlds.delete(channelId)
		chatMetadata.LastTimeSlice.world = undefined
		chatMetadata.LastTimeSlice.world_id = undefined
		if (is_VividChat(chatMetadata)) saveChat(groupId)
		broadcastChatEvent(groupId, { type: 'world_set', payload: { channelId, worldname: null } })
		return null
	}
	const { username, chatLog } = chatMetadata
	const timeSlice = chatMetadata.LastTimeSlice.copy()
	const world = timeSlice.world = await loadPart(username, `worlds/${worldname}`)
	timeSlice.world_id = worldname

	chatMetadata.channelWorlds.set(channelId, worldname)

	if (world.interfaces.chat.GetGreeting && !chatLog.length)
		timeSlice.greeting_type = 'world_single'
	else if (world.interfaces.chat.GetGroupGreeting && chatLog.length)
		timeSlice.greeting_type = 'world_group'

	broadcastChatEvent(groupId, { type: 'world_set', payload: { channelId, worldname } })

	try {
		const request = await getChatRequest(groupId, undefined, channelId)
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
		await addChatLogEntry(groupId, greeting_entry)
		return greeting_entry
	}
	catch {
		chatMetadata.LastTimeSlice.world = timeSlice.world
		chatMetadata.LastTimeSlice.world_id = timeSlice.world_id
	}

	if (is_VividChat(chatMetadata)) saveChat(groupId)
	return null
}

/**
 * 向聊天添加角色并尝试插入问候；失败时回滚 LastTimeSlice 中的角色引用。
 * @param {string} groupId 聊天 ID
 * @param {string} charname 角色名
 * @returns {Promise<chatLogEntry_t | null>} 问候条目或 null
 */
export async function addchar(groupId, charname) {
	const chatMetadata = await loadChat(groupId)
	if (!chatMetadata) throw new Error('Chat not found')

	const { username } = chatMetadata
	const timeSlice = chatMetadata.LastTimeSlice.copy()
	if (Object.keys(timeSlice.chars).length)
		timeSlice.greeting_type = 'group'
	else
		timeSlice.greeting_type = 'single'

	if (timeSlice.chars[charname]) return null

	const char = timeSlice.chars[charname] = await loadPart(username, `chars/${charname}`)
	broadcastChatEvent(groupId, { type: 'char_added', payload: { charname } })

	const defCh = await getDefaultChannelId(username, groupId).catch(() => 'default')
	const request = await getChatRequest(groupId, charname, defCh)

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
		await addChatLogEntry(groupId, greeting_entry)
		return greeting_entry
	}
	catch (error) {
		console.error(error)
		chatMetadata.LastTimeSlice.chars[charname] = timeSlice.chars[charname]
	}
	if (is_VividChat(chatMetadata)) saveChat(groupId)
	return null
}

/**
 * 从聊天移除角色并广播 char_removed。
 * @param {string} groupId 聊天 ID
 * @param {string} charname 角色名
 * @returns {Promise<void>}
 */
export async function removechar(groupId, charname) {
	const chatMetadata = await loadChat(groupId)
	delete chatMetadata.LastTimeSlice.chars[charname]
	if (is_VividChat(chatMetadata)) saveChat(groupId)
	broadcastChatEvent(groupId, { type: 'char_removed', payload: { charname } })
}

/**
 * 向聊天添加插件部件并广播 plugin_added。
 * @param {string} groupId 聊天 ID
 * @param {string} pluginname 插件名
 * @returns {Promise<void>}
 */
export async function addplugin(groupId, pluginname) {
	const chatMetadata = await loadChat(groupId)
	if (!chatMetadata) throw new Error('Chat not found')

	const { username } = chatMetadata
	const timeSlice = chatMetadata.LastTimeSlice.copy()

	if (timeSlice.plugins[pluginname]) return

	timeSlice.plugins[pluginname] = await loadPart(username, `plugins/${pluginname}`)
	broadcastChatEvent(groupId, { type: 'plugin_added', payload: { pluginname } })

	if (is_VividChat(chatMetadata)) saveChat(groupId)
}

/**
 * 从聊天移除插件并广播 plugin_removed。
 * @param {string} groupId 聊天 ID
 * @param {string} pluginname 插件名
 * @returns {Promise<void>}
 */
export async function removeplugin(groupId, pluginname) {
	const chatMetadata = await loadChat(groupId)
	delete chatMetadata.LastTimeSlice.plugins[pluginname]
	if (is_VividChat(chatMetadata)) saveChat(groupId)
	broadcastChatEvent(groupId, { type: 'plugin_removed', payload: { pluginname } })
}

/**
 * 返回当前聊天已加载的角色 ID 列表。
 * @param {string} groupId 聊天 ID
 * @returns {Promise<string[]>} 角色名数组
 */
export async function getCharListOfChat(groupId) {
	const chatMetadata = await loadChat(groupId)
	return Object.keys(chatMetadata.LastTimeSlice.chars)
}

/**
 * 返回当前聊天已加载的插件 ID 列表。
 * @param {string} groupId 聊天 ID
 * @returns {Promise<string[]>} 插件名数组
 */
export async function getPluginListOfChat(groupId) {
	const chatMetadata = await loadChat(groupId)
	return Object.keys(chatMetadata.LastTimeSlice.plugins)
}

/**
 * 返回内存中聊天日志的切片（与频道参数保留兼容，实际按群 chatLog）。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID（兼容参数）
 * @param {number} start 起始索引
 * @param {number} end 结束索引（不含）
 * @returns {Promise<chatLogEntry_t[]>} 日志条目数组
 */
export async function GetChatLog(groupId, channelId, start, end) {
	const chatMetadata = await loadChat(groupId)
	return chatMetadata.chatLog.slice(start, end)
}

/**
 * 返回内存中聊天日志条数。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID（兼容参数）
 * @returns {Promise<number>} 条数
 */
export async function GetChatLogLength(groupId, channelId) {
	const chatMetadata = await loadChat(groupId)
	return chatMetadata.chatLog.length
}

/**
 * 返回当前聊天绑定的人格 ID。
 * @param {string} groupId 聊天 ID
 * @returns {Promise<string | undefined>} 人格名
 */
export async function GetUserPersonaName(groupId) {
	const chatMetadata = await loadChat(groupId)
	return chatMetadata.LastTimeSlice.player_id
}

/**
 * 返回指定频道绑定的世界名，缺省则回落到 LastTimeSlice。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<string | undefined>} 世界名
 */
export async function GetWorldName(groupId, channelId) {
	channelId = channelId ?? 'default'
	const chatMetadata = await loadChat(groupId)
	const channelWorld = chatMetadata.channelWorlds?.get(channelId)
	return channelWorld ?? chatMetadata.LastTimeSlice.world_id
}

/**
 * 根据频率与 @mention 偏好自动触发下一个角色回复。
 * @param {string} groupId 聊天 ID
 * @param {string | null} channelId 群频道 ID（可 null）
 * @param {Array<{ charname: string | null, frequency: number }>} freq_data 频率表
 * @param {string | null} initial_char 上一轮发言角色
 * @param {string | null} preferCharName @mention 优先角色
 * @returns {Promise<void>}
 */
async function handleAutoReply(groupId, channelId, freq_data, initial_char, preferCharName) {
	const chatMetadata = await loadChat(groupId)
	if (!chatMetadata) return
	const { username } = chatMetadata
	const effCh = channelId || await getDefaultChannelId(username, groupId).catch(() => 'default')
	const worldName = await GetWorldName(groupId, effCh)
	const channelWorld = worldName ? await loadPart(username, `worlds/${worldName}`).catch(() => null) : null
	if (channelWorld?.interfaces?.chat?.GetSpeakingOrder) 
		try {
			const ctx = {
				groupId,
				channelId: effCh,
				username,
				chatReplyRequest: await getChatRequest(groupId, undefined, effCh),
			}
			for await (const turn of channelWorld.interfaces.chat.GetSpeakingOrder(ctx)) {
				if (turn.type === 'char' && turn.memberId) {
					let cn = turn.memberId
					const colon = turn.memberId.indexOf(':')
					if (colon >= 0) {
						const u = turn.memberId.slice(0, colon)
						cn = turn.memberId.slice(colon + 1)
						if (u !== username) continue
					}
					if (chatMetadata.LastTimeSlice.chars[cn]) {
						await triggerCharReply(groupId, channelId, cn, turn.requestOverride || null)
						return
					}
				}
				if (turn.type === 'user') {
					broadcastChatEvent(groupId, { type: 'speaking_order_user_turn', payload: { channelId: effCh } })
					return
				}
			}
		}
		catch (e) {
			console.error(e)
		}
	

	if (preferCharName && freq_data.some(f => f.charname === preferCharName))
		try {
			await triggerCharReply(groupId, channelId, preferCharName)
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
			await triggerCharReply(groupId, channelId, nextreply)
			return
		} catch (error) {
			console.error(error)
			char = nextreply
		} else return
	}
}

/**
 * 根据占位条目前的用户消息推断流式生成应归属的群频道 ID。
 * @param {chatMetadata_t} chatMetadata 元数据
 * @param {chatLogEntry_t} placeholderEntry 生成中的占位条目
 * @returns {string} 频道 ID 或 default
 */
function getChannelForCharStream(chatMetadata, placeholderEntry) {
	const idx = chatMetadata.chatLog.findIndex(e => e.id === placeholderEntry.id)
	for (let i = idx - 1; i >= 0; i--) {
		const e = chatMetadata.chatLog[i]
		if (e.role === 'user' && e.extension?.groupChannelId) {
			const g = String(e.extension.groupChannelId).trim()
			if (isValidChannelId(g)) return g
		}
	}
	return 'default'
}

/**
 * 将赞踩等反馈镜像为 DAG message_feedback 事件。
 * @param {string} groupId 聊天 ID
 * @param {chatLogEntry_t} entry 目标条目
 * @param {{ type: string, content?: string }} feedback 反馈载荷
 * @param {string} username 所有者
 * @returns {Promise<void>}
 */
async function mirrorFeedbackToDag(groupId, entry, feedback, username) {
	try {
		if (!entry?.id || !username) return
		if (entry.timeSlice?.greeting_type) return
		if (!feedback?.type) return
		await ensureChat(username, groupId)
		await appendEvent(username, groupId, {
			type: 'message_feedback',
			channelId: await getDefaultChannelId(username, groupId),
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

/**
 * 追加聊天日志：推送 WS、同步 DAG、触发自动回复与通知。
 * @param {string} groupId 聊天 ID
 * @param {chatLogEntry_t} entry 新条目
 * @returns {Promise<chatLogEntry_t>} 同一引用
 */
async function addChatLogEntry(groupId, entry) {
	const chatMetadata = await loadChat(groupId)
	if (entry.timeSlice.world?.interfaces?.chat?.AddChatLogEntry)
		await entry.timeSlice.world.interfaces.chat.AddChatLogEntry(await getChatRequest(groupId, undefined, entry.extension?.groupChannelId || null), entry)
	else
		chatMetadata.chatLog.push(entry)

	const sidecarChannel = isValidChannelId(entry.extension?.groupChannelId)
		? entry.extension.groupChannelId
		: await getDefaultChannelId(chatMetadata.username, groupId).catch(() => 'default')
	await persistLogContextSidecar(chatMetadata.username, groupId, sidecarChannel, entry)

	if (entry.role === 'char' && entry.timeSlice.charname) {
		const spokenChars = new Set(chatMetadata.chatLog.filter(e => e.role === 'char' && e.timeSlice.charname).map(e => e.timeSlice.charname))
		if (spokenChars.size >= 2)
			void unlockAchievement(chatMetadata.username, 'shells/chat', 'multiplayer_chat')
	}

	chatMetadata.timeLines = [entry]
	chatMetadata.timeLineIndex = 0
	chatMetadata.LastTimeSlice = entry.timeSlice

	if (is_VividChat(chatMetadata)) saveChat(groupId)
	broadcastChatEvent(groupId, { type: 'message_added', payload: await entry.toData(chatMetadata.username) })

	const owner = chatMetadatas.get(groupId)?.username
	await syncChatLogEntryToDag(groupId, entry, owner)

	if (entry.role === 'char')
		sendNotification(chatMetadata.username, entry.name ?? 'Character', {
			body: entry.content,
			icon: entry.avatar || '/favicon.svg',
			data: {
				url: `/parts/shells:chat/hub/#group:${groupId}:default`,
			},
		}, `/parts/shells:chat/hub/#group:${groupId}:default`)

	const freq_data = await getCharReplyFrequency(groupId)
	let mentionTarget = null
	if (entry.role === 'user') {
		const c = entry.content
		const text = typeof c === 'string' ? c : c && typeof c === 'object' ? c.text : ''
		if (typeof text === 'string') {
			const mm = text.match(/^@([\w.-]+)(?:\s|$)/u)
			if (mm?.[1] && chatMetadata.LastTimeSlice.chars[mm[1]])
				mentionTarget = mm[1]
		}
	}
	if (entry.timeSlice.world?.interfaces?.chat?.AfterAddChatLogEntry)
		await entry.timeSlice.world.interfaces.chat.AfterAddChatLogEntry(await getChatRequest(groupId, undefined, entry.extension?.groupChannelId || null), freq_data)
	else
		handleAutoReply(groupId, entry.extension?.groupChannelId || null, freq_data, entry.timeSlice.charname ?? null, mentionTarget)

	return entry
}

/**
 * 从流式预览用的 reply 对象提取可比对的纯文本。
 * @param {object | null | undefined} reply 角色回复中间态
 * @returns {string} 预览文本
 */
function replyPreviewText(reply) {
	if (!reply) return ''
	if (typeof reply.content === 'string') return reply.content
	if (reply.content_for_show != null) return String(reply.content_for_show)
	return ''
}

/**
 * 执行单次角色 GetReply 流式生成：起止广播、替换占位条目、错误处理。
 * @param {string} groupId 聊天 ID
 * @param {object} request chatReplyRequest
 * @param {{ update: Function, done: Function, abort: Function, signal: AbortSignal }} stream 流管理器
 * @param {chatLogEntry_t} placeholderEntry 占位条目
 * @param {chatMetadata_t} chatMetadata 元数据引用
 * @returns {Promise<void>}
 */
async function executeGeneration(groupId, request, stream, placeholderEntry, chatMetadata) {
	const entryId = placeholderEntry.id
	const channelForStream = getChannelForCharStream(chatMetadata, placeholderEntry)

	/**
		 * 结束流：广播 group_stream_end、替换日志、可选同步 DAG。
		 * @param {chatLogEntry_t} finalEntry 最终条目
		 * @param {boolean} [isError] 是否为错误占位内容
		 * @returns {Promise<chatLogEntry_t>} 最终条目
		 */
	const finalizeEntry = async (finalEntry, isError = false) => {
		try {
			broadcastGroupEvent(groupId, {
				type: 'group_stream_end',
				channelId: channelForStream,
				pendingStreamId: entryId,
			})
			finishStreamBuffer(groupId, entryId)
		}
		catch (e) {
			console.error('group stream end broadcast failed:', e)
		}
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

		broadcastChatEvent(groupId, {
			type: 'message_replaced',
			payload: { index: idx, entry: await finalEntry.toData(chatMetadata.username) },
		})

		const owner = chatMetadatas.get(groupId)?.username
		if (!isError && !finalEntry.extension?.aborted)
			await syncChatLogEntryToDag(groupId, finalEntry, owner)

		if (!isError && is_VividChat(chatMetadata)) saveChat(groupId)
		return finalEntry
	}

	try {
		broadcastChatEvent(groupId, {
			type: 'stream_start',
			payload: { messageId: entryId },
		})
		try {
			broadcastGroupEvent(groupId, {
				type: 'group_stream_start',
				channelId: channelForStream,
				pendingStreamId: entryId,
				charId: request.char_id,
			})
		}
		catch (e) {
			console.error('group_stream_start broadcast failed:', e)
		}

		let prevVolatileText = ''
		let volatileChunkSeq = 0
		request.generation_options = {
			/**
			 * 流式增量更新：推送到客户端与群 volatile 通道。
			 * @param {object} reply 中间回复对象
			 * @returns {void}
			 */
			replyPreviewUpdater: reply => {
				stream.update(reply)
				const t = replyPreviewText(reply)
				const delta = t.slice(prevVolatileText.length)
				if (delta) {
					volatileChunkSeq++
					try {
						broadcastGroupEvent(groupId, {
							type: 'group_stream_chunk',
							channelId: channelForStream,
							pendingStreamId: entryId,
							chunkSeq: volatileChunkSeq,
							text: delta,
							charId: request.char_id,
						})
						bufferStreamChunk(groupId, entryId, volatileChunkSeq, delta)
					}
					catch (e) {
						console.error('group_stream_chunk broadcast failed:', e)
					}
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
				broadcastGroupEvent(groupId, {
					type: 'group_stream_end',
					channelId: channelForStream,
					pendingStreamId: entryId,
				})
				finishStreamBuffer(groupId, entryId)
			}
			catch (e) {
				console.error('group_stream_end (null result) broadcast failed:', e)
			}
			const idx = chatMetadata.chatLog.findIndex(e => e.id === entryId)
			if (idx !== -1) await deleteMessage(groupId, null, idx)
			return
		}

		const finalEntry = await BuildChatLogEntryFromCharReply(
			result,
			placeholderEntry.timeSlice,
			request.char,
			request.char_id,
			chatMetadata.username,
		)

		const persistCh = finalEntry.extension?.groupChannelId || channelForStream
		await persistLogContextSidecar(chatMetadata.username, groupId, persistCh, finalEntry)

		const savedEntry = await finalizeEntry(finalEntry, false)

		const freq_data = await getCharReplyFrequency(groupId)
		if (savedEntry.timeSlice.world?.interfaces?.chat?.AfterAddChatLogEntry)
			await savedEntry.timeSlice.world.interfaces.chat.AfterAddChatLogEntry(await getChatRequest(groupId, undefined, savedEntry.extension?.groupChannelId || null), freq_data)
		else
			await handleAutoReply(groupId, savedEntry.extension?.groupChannelId || null, freq_data, savedEntry.timeSlice.charname ?? null)
	}
	catch (e) {
		if (e.name === 'AbortError') {
			placeholderEntry.is_generating = false
			placeholderEntry.extension = { ...placeholderEntry.extension, aborted: true }
			await finalizeEntry(placeholderEntry, false)
		}
		else {
			stream.abort(e?.message)

			/**
			 * 将任意错误值格式化为可读诊断文本。
			 * @param {unknown} e 错误或其它值
			 * @returns {string} 诊断字符串
			 */
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
		updateTypingStatus(groupId, request.char_id, -1)
	}
}

/**
 * 返回群会话当前时间线索引与分支总数（用于前端 ◀/▶ 导航）。
 * @param {string} groupId 群组/聊天 ID
 * @returns {Promise<{ current: number, total: number } | null>} 无元数据时为 null
 */
export async function getChatTimelineCursor(groupId) {
	const chatMetadata = await loadChat(groupId)
	if (!chatMetadata) return null
	const total = Math.max(1, chatMetadata.timeLines?.length || 1)
	const raw = Number(chatMetadata.timeLineIndex) || 0
	const current = Math.min(Math.max(0, raw), total - 1)
	return { current, total }
}

/**
 * 在时间线上前进/后退：可能触发新 greeting 或流式 GetReply。
 * @param {string} groupId 聊天 ID
 * @param {string} channelId 频道 ID（兼容参数）
 * @param {number} delta 时间线索引偏移
 * @returns {Promise<chatLogEntry_t | undefined>} 当前（或新建）时间线末端条目
 */
export async function modifyTimeLine(groupId, channelId, delta) {
	StreamManager.abortAll(groupId)

	const chatMetadata = await loadChat(groupId)

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

		broadcastChatEvent(groupId, {
			type: 'message_replaced',
			payload: { index: chatMetadata.chatLog.length - 1, entry: await newEntry.toData(chatMetadata.username) },
		})

		if (greeting_type)
			try {
				const { charname } = timeSlice
				const request = await getChatRequest(groupId, charname || undefined, getChannelForCharStream(chatMetadata, newEntry))
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

				if (is_VividChat(chatMetadata)) saveChat(groupId)

				broadcastChatEvent(groupId, {
					type: 'message_replaced',
					payload: { index: chatMetadata.chatLog.length - 1, entry: await newEntry.toData(chatMetadata.username) },
				})
			} catch (e) {
				console.error('Greeting generation failed:', e)
				newEntry.content = `\`\`\`\nError generating greeting:\n${e.message}\n\`\`\``
				newEntry.is_generating = false
				newEntry.id = entry.id
				newEntry.timeSlice = timeSlice
				broadcastChatEvent(groupId, {
					type: 'message_replaced',
					payload: { index: chatMetadata.chatLog.length - 1, entry: await newEntry.toData(chatMetadata.username) },
				})
			}

		else {
			const { charname } = timeSlice
			const request = await getChatRequest(groupId, charname, getChannelForCharStream(chatMetadata, newEntry))
			const stream = StreamManager.create(groupId, newEntry.id)
			executeGeneration(groupId, request, stream, newEntry, chatMetadata)
		}
	} else {
		entry = chatMetadata.timeLines[newTimeLineIndex]
		chatMetadata.timeLineIndex = newTimeLineIndex
		chatMetadata.LastTimeSlice = entry.timeSlice
		chatMetadata.chatLog[chatMetadata.chatLog.length - 1] = entry

		if (is_VividChat(chatMetadata)) saveChat(groupId)

		broadcastChatEvent(groupId, {
			type: 'message_replaced',
			payload: { index: chatMetadata.chatLog.length - 1, entry: await entry.toData(chatMetadata.username) }
		})
	}

	return entry
}

/**
 * 将角色 GetReply/GetGreeting 结果装配为 chatLogEntry_t。
 * @param {object} result 角色接口返回对象
 * @param {timeSlice_t} new_timeSlice 快照时间切片
 * @param {CharAPI_t | null} char 角色部件（世界问候时可为 null）
 * @param {string | undefined} charname 角色名
 * @param {string} username 用户
 * @returns {Promise<chatLogEntry_t>} 新日志条目
 */
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
		logContextAfter: result.logContextAfter,
		charVisibility: result.charVisibility,
		visibility: result.visibility,
	})
	return entry
}

/**
 * 将用户发送载荷装配为 chatLogEntry_t（含群频道扩展）。
 * @param {object} result 用户消息对象
 * @param {timeSlice_t} new_timeSlice 快照时间切片
 * @param {UserAPI_t | undefined} user 用户部件
 * @param {string | undefined} personaname 人格名
 * @param {string} username 用户
 * @returns {Promise<chatLogEntry_t>} 新日志条目
 */
async function BuildChatLogEntryFromUserMessage(result, new_timeSlice, user, personaname, username) {
	new_timeSlice.playername = new_timeSlice.player_id
	const { info } = (personaname ? await getPartDetails(username, `personas/${personaname}`) : undefined) || {}
	const entry = new chatLogEntry_t()
	const ext = { ...result.extension || {} }
	if (typeof result.groupChannelId === 'string') {
		const g = result.groupChannelId.trim().slice(0, 128)
		if (isValidChannelId(g))
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
		extension: ext,
		charVisibility: result.charVisibility,
		visibility: result.visibility,
	})
	return entry
}

/**
 * 获取角色回复频率数据（通过 onMessage 事件决定角色是否发言）。
 * @param {string} groupId 聊天 ID
 * @returns {Promise<Array<{ charname: string | null, frequency: number }>>} 含默认项的频率表
 */
async function getCharReplyFrequency(groupId) {
	const chatMetadata = await loadChat(groupId)
	if (!chatMetadata) throw new Error('Chat not found')
	const result = [{ charname: null, frequency: 1 }]
	const defCh = await getDefaultChannelId(chatMetadata.username, groupId).catch(() => 'default')

	for (const charname in chatMetadata.LastTimeSlice.chars) {
		const char = chatMetadata.LastTimeSlice.chars[charname]
		let frequency = 1
		if (char.interfaces?.chat?.onMessage) {
			const onlineCount = Object.keys(chatMetadata.LastTimeSlice.chars).length + 1
			const spoke = await char.interfaces.chat.onMessage({
				chatReplyRequest: await getChatRequest(groupId, charname, defCh),
				onlineCount,
			}).catch(() => false)
			frequency = spoke ? 1e6 : 0
		}
		if (frequency > 0)
			result.push({ charname, frequency })
	}

	return result
}

/**
 * 按加权随机选择下一个应回复的角色名。
 * @param {Array<{ charname: string | null, frequency: number }>} frequency_data 频率表
 * @returns {Promise<string | null | undefined>} 角色名；无可选时 null/undefined
 */
async function getNextCharForReply(frequency_data) {
	const all_freq = frequency_data.map(x => x.frequency).reduce((a, b) => a + b, 0)
	if (all_freq <= 0) return null
	let random = Math.random() * all_freq

	for (const { charname, frequency } of frequency_data)
		if (random < frequency) return charname
		else random -= frequency
}

/**
 * 触发角色回复：可指定 charname，或由频率表自动挑选；异步启动 executeGeneration。
 * @param {string} groupId 聊天 ID
 * @param {string | null} channelId 群频道 ID
 * @param {string | undefined} charname 角色名；可省略
 * @param {Record<string, unknown> | null} [requestOverride] 合并进 chatReplyRequest（如 world 覆写 chat_log）
 * @returns {Promise<void>}
 */
export async function triggerCharReply(groupId, channelId, charname, requestOverride = null) {
	const chatMetadata = await loadChat(groupId)
	if (!chatMetadata) throw new Error('Chat not found')

	if (!charname) {
		const frequency_data = (await getCharReplyFrequency(groupId)).filter(x => x.charname !== null)
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
	if (channelId)
		placeholder.extension = { groupChannelId: channelId }

	broadcastChatEvent(groupId, {
		type: 'message_added',
		payload: await placeholder.toData(chatMetadata.username),
	})

	const request = await getChatRequest(groupId, charname, channelId)
	if (requestOverride && typeof requestOverride === 'object')
		Object.assign(request, requestOverride)

	const stream = StreamManager.create(groupId, placeholder.id)

	updateTypingStatus(groupId, charname, 1)

	executeGeneration(groupId, request, stream, placeholder, chatMetadata)
}

/**
 * 添加用户消息到聊天日志（含群频道扩展）。
 * @param {string} groupId 聊天 ID
 * @param {string} channelId 群频道 ID
 * @param {object} object 用户回复载荷（content、files 等）
 * @returns {Promise<chatLogEntry_t>} 新条目
 */
export async function addUserReply(groupId, channelId, object) {
	const chatMetadata = await loadChat(groupId)
	if (!chatMetadata) throw new Error('Chat not found')

	const timeSlice = chatMetadata.LastTimeSlice
	const new_timeSlice = timeSlice.copy()
	const user = timeSlice.player

	return addChatLogEntry(groupId, await BuildChatLogEntryFromUserMessage(object, new_timeSlice, user, new_timeSlice.player_id, chatMetadata.username))
}

/**
 * 删除指定索引消息：调用世界/角色/用户 MessageDelete 钩子或默认 splice。
 * @param {string} groupId 聊天 ID
 * @param {string} channelId 频道 ID（兼容参数）
 * @param {number} index chatLog 索引
 * @returns {Promise<void>}
 */
export async function deleteMessage(groupId, channelId, index) {
	const chatMetadata = await loadChat(groupId)
	if (!chatMetadata) throw new Error('Chat not found')
	if (!chatMetadata.chatLog[index]) throw new Error('Invalid index')

	const entry = chatMetadata.chatLog[index]
	if (entry) {
		StreamManager.abortByMessageId(entry.id)
		const scCh = isValidChannelId(entry.extension?.groupChannelId)
			? entry.extension.groupChannelId
			: channelId || 'default'
		deleteLogContextSidecar(chatMetadata.username, groupId, scCh, entry.id)
	}

	/**
		 * 构造传给各部件 MessageDelete 的请求对象。
		 * @returns {{ index: number, chat_log: chatLogEntry_t[], chat_entry: chatLogEntry_t }} 删除请求
		 */
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

	if (is_VividChat(chatMetadata)) saveChat(groupId)
	broadcastChatEvent(groupId, { type: 'message_deleted', payload: { index } })

	const owner = chatMetadatas.get(groupId)?.username
	await mirrorDeleteToDag(groupId, entry, owner)
	await reconcileContextSidecarsWithChatLog(chatMetadata.username, groupId, chatMetadata.chatLog)
}

/**
 * 编辑指定索引消息：经世界/角色 MessageEdit 后写回并镜像 DAG。
 * @param {string} groupId 聊天 ID
 * @param {string} channelId 频道 ID（兼容参数）
 * @param {number} index chatLog 索引
 * @param {object} new_content 编辑载荷
 * @returns {Promise<chatLogEntry_t>} 更新后的条目
 */
export async function editMessage(groupId, channelId, index, new_content) {
	const chatMetadata = await loadChat(groupId)
	if (!chatMetadata) throw new Error('Chat not found')
	if (!chatMetadata.chatLog[index]) throw new Error('Invalid index')

	const originalEntryId = chatMetadata.chatLog[index].id

	/**
		 * 构造传给各部件 MessageEdit/MessageEditing 的请求对象。
		 * @returns {{ index: number, original: chatLogEntry_t, edited: object, chat_log: chatLogEntry_t[] }} 编辑请求
		 */
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

	if (is_VividChat(chatMetadata)) saveChat(groupId)
	broadcastChatEvent(groupId, { type: 'message_edited', payload: { index, entry: await entry.toData(chatMetadata.username) } })

	const owner = chatMetadatas.get(groupId)?.username
	await mirrorEditToDag(groupId, originalEntryId, entry, owner)

	return entry
}

/**
 * 设置消息反馈扩展字段并广播替换事件、镜像 DAG。
 * @param {string} groupId 聊天 ID
 * @param {string} channelId 频道 ID（兼容参数）
 * @param {number} index chatLog 索引
 * @param {object} feedback 反馈对象
 * @returns {Promise<chatLogEntry_t>} 更新后的条目
 */
export async function setMessageFeedback(groupId, channelId, index, feedback) {
	const chatMetadata = await loadChat(groupId)
	if (!chatMetadata) throw new Error('Chat not found')
	if (!chatMetadata.chatLog[index]) throw new Error('Invalid index')
	const entry = chatMetadata.chatLog[index]
	entry.extension ??= {}
	entry.extension.feedback = feedback
	if (index === chatMetadata.chatLog.length - 1 && chatMetadata.timeLines[chatMetadata.timeLineIndex]?.id === entry.id)
		chatMetadata.timeLines[chatMetadata.timeLineIndex] = entry
	if (is_VividChat(chatMetadata)) saveChat(groupId)
	broadcastChatEvent(groupId, { type: 'message_replaced', payload: { index, entry: await entry.toData(chatMetadata.username) } })

	const owner = chatMetadatas.get(groupId)?.username
	await mirrorFeedbackToDag(groupId, entry, feedback, owner)

	return entry
}

/**
 * 前端进入聊天页所需的初始快照（角色列表、最近日志等）。
 * @param {string} groupId 聊天 ID
 * @returns {Promise<object>} 初始数据对象
 */
export async function getInitialData(groupId) {
	const chatMetadata = await loadChat(groupId)
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
	for (const [groupId, data] of chatMetadatas.entries())
		if (data.username === username)
			chatIdsToDeleteFromCache.push(groupId)
	chatIdsToDeleteFromCache.forEach(groupId => chatMetadatas.delete(groupId))
})

events.on('AfterUserRenamed', async ({ oldUsername, newUsername }) => {
	for (const [groupId, data] of chatMetadatas.entries())
		if (data.username === oldUsername) {
			data.username = newUsername
			if (data.chatMetadata && data.chatMetadata.username === oldUsername)
				data.chatMetadata.username = newUsername
			saveChat(groupId)
		}
})

/**
 *
 */
export const tryInvokeLocalCharRpc = createCharRpcDispatcher(loadChat, getChatRequest)
