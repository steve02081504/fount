/**
 * 【文件】models.mjs — 聊天会话领域模型（时间切片、日志条目、元数据）
 * 【职责】定义 timeSlice_t（某时刻的角色/世界/人格/插件上下文）、chatLogEntry_t（单条消息）、chatMetadata_t（会话容器）；提供 JSON/磁盘 toData/fromJSON 与 StartNewAs 默认部件装配。
 * 【原理】timeSlice 运行时持有部件 API 引用，持久化仅存 ID 列表；chatLogEntry 文件 buffer 在 toJSON 中转 base64、在 toData 中落为 file: 句柄；chatMetadata 正文 chatLog 由 DAG 水合，磁盘只保留 greetingLog 与 persistedTimeSlice。
 * 【数据结构】timeSlice_t、chatLogEntry_t（id/role/content/extension.timeSlice/files/extension/is_generating）、chatMetadata_t（username/chatLog/timeLines/LastTimeSlice）。
 * 【关联】parts_loader、entity/files/evfs、runtime.buildTimeSliceFromSession、dag/hydration。
 */
/** @typedef {import('../../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../../../decl/userAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../../../decl/pluginAPI.ts').PluginAPI_t} PluginAPI_t */

import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'

import { putFileManifest } from '../../../../../../../scripts/p2p/entity/files/evfs.mjs'
import { formatEvfsRef, parseEvfsRef } from '../../../../../../../scripts/p2p/entity/files/evfs_ref.mjs'
import { resolveOperatorEntityHash } from '../lib/replica.mjs'

/**
 * @param {Buffer | string} buffer 文件内容或 evfs 引用
 * @returns {string} JSON 可序列化的 buffer 字段
 */
function serializeFileBuffer(buffer) {
	if (typeof buffer === 'string') return buffer
	if (Buffer.isBuffer(buffer)) return buffer.toString('base64')
	return String(buffer)
}

import { createNewChatMetadata } from './factory.mjs'
import { hydrateTimeSlice } from './hydrate.mjs'

/**
 * 代表聊天中特定时间点的"时间切片"，包含了该时刻的所有上下文状态。
 */
export class timeSlice_t {
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
		const next = Object.assign(new timeSlice_t(), this, {
			charname: undefined,
			playername: undefined,
			greeting_type: undefined,
		})
		next.chars_speaking_frequency = structuredClone(this.chars_speaking_frequency)
		next.chars_memories = structuredClone(this.chars_memories)
		return next
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
		return Object.assign(new timeSlice_t(), await hydrateTimeSlice(json, username))
	}
}

/**
 * 代表聊天记录中的单条消息条目。
 * 权威字段形状见 `src/decl/chatLog.ts`：`timeSlice` 存于 `extension.timeSlice`。
 */
export class chatLogEntry_t {
	/** @type {string} */
	id
	name
	avatar
	time_stamp
	role
	content
	content_for_show
	content_for_edit
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
			id: this.id,
			name: this.name,
			avatar: this.avatar,
			time_stamp: this.time_stamp,
			role: this.role,
			content: this.content,
			content_for_show: this.content_for_show,
			content_for_edit: this.content_for_edit,
			is_generating: this.is_generating,
			files: this.files.map(file => ({
				name: file.name,
				mime_type: file.mime_type,
				buffer: serializeFileBuffer(file.buffer),
				description: file.description,
				...file.extension ? { extension: file.extension } : {},
			})),
			extension: {
				...this.extension,
				timeSlice: this.extension.timeSlice?.toJSON?.() ?? {},
			},
		}
	}

	/**
	 * 导出条目数据并将文件落盘为 file: 引用。
	 * @param {string} username 所属用户
	 * @returns {Promise<object>} 数据对象
	 */
	async toData(username) {
		const operatorEntityHash = await resolveOperatorEntityHash(username)
		return {
			id: this.id,
			name: this.name,
			avatar: this.avatar,
			time_stamp: this.time_stamp,
			role: this.role,
			content: this.content,
			content_for_show: this.content_for_show,
			content_for_edit: this.content_for_edit,
			is_generating: this.is_generating,
			extension: {
				...this.extension,
				timeSlice: this.extension.timeSlice ? await this.extension.timeSlice.toData() : {},
			},
			files: await Promise.all(this.files.map(async file => {
				if (typeof file.buffer === 'string' && parseEvfsRef(file.buffer))
					return { ...file, buffer: file.buffer }
				if (!operatorEntityHash)
					throw new Error('identity required to persist chat attachments')
				const plain = Buffer.isBuffer(file.buffer)
					? file.buffer
					: Buffer.from(String(file.buffer), 'base64')
				const attachId = crypto.randomUUID()
				const logicalPath = `shells/chat/attachments/${attachId}`
				await putFileManifest({
					ownerEntityHash: operatorEntityHash,
					logicalPath,
					plaintext: plain,
					name: file.name,
					mimeType: file.mime_type || 'application/octet-stream',
					ceMode: 'convergent',
				})
				return {
					...file,
					buffer: formatEvfsRef(operatorEntityHash, logicalPath),
				}
			})),
		}
	}

	/**
	 * 从 JSON 恢复聊天日志条目（含时间切片与文件）。
	 * @param {object} json 序列化对象
	 * @param {string} username 所属用户
	 * @returns {Promise<chatLogEntry_t>} 条目实例
	 */
	static async fromJSON(json, username) {
		const extension = { ...json.extension || {} }
		extension.timeSlice = await timeSlice_t.fromJSON(extension.timeSlice || {}, username)
		const instance = Object.assign(new chatLogEntry_t(), {
			id: json.id,
			name: json.name,
			avatar: json.avatar,
			time_stamp: json.time_stamp,
			role: json.role,
			content: json.content,
			content_for_show: json.content_for_show,
			content_for_edit: json.content_for_edit,
			is_generating: json.is_generating,
			extension,
			files: (json.files || []).map(file => {
				const buffer = file?.buffer
				if (typeof buffer === 'string' && parseEvfsRef(buffer))
					return { ...file, buffer }
				return {
					...file,
					buffer: Buffer.from(buffer, 'base64'),
				}
			}),
		})
		if (!instance.id)
			instance.id = crypto.randomUUID()

		return instance
	}
}

/**
 * 描述一个完整聊天的元数据。每个聊天天然对应一个 DAG 群组（groupId === groupId）。
 */
export class chatMetadata_t {
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
	static StartNewAs(username) {
		return createNewChatMetadata(username)
	}

	/**
	 * 导出精简持久化视图（正文 chatLog 由 DAG 承载时为空数组）。
	 * @returns {object} 可写入磁盘的 JSON 形状
	 */
	toJSON() {
		return {
			username: this.username,
			greetingLog: this.chatLog.filter(e => e.extension.timeSlice?.greeting_type).map(log => log.toJSON()),
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
		const prelude = this.chatLog.filter(e => e.extension.timeSlice?.greeting_type)
		return {
			username: this.username,
			greetingLog: await Promise.all(prelude.map(async log => log.toData(this.username))),
			persistedTimeSlice: await this.LastTimeSlice.toData(),
			chatLog: [],
			timeLines: [],
			timeLineIndex: 0,
		}
	}

	/**
	 * 从磁盘 JSON 恢复元数据（问候 greetingLog + persistedTimeSlice；正文由 DAG 水合）。
	 * @param {object} json 持久化对象
	 * @returns {Promise<chatMetadata_t>} 元数据实例
	 */
	static async fromJSON(json) {
		const chatLog = await Promise.all((json.greetingLog || []).map(data => chatLogEntry_t.fromJSON(data, json.username)))

		for (const entry of chatLog)
			if (entry.is_generating) entry.is_generating = false

		const LastTimeSlice = json.persistedTimeSlice
			? await timeSlice_t.fromJSON(json.persistedTimeSlice, json.username)
			: chatLog.length ? chatLog[chatLog.length - 1].extension.timeSlice : new timeSlice_t()

		return Object.assign(new chatMetadata_t(), {
			username: json.username,
			chatLog,
			timeLines: [],
			timeLineIndex: 0,
			LastTimeSlice,
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
