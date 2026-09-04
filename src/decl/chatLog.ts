import { Buffer } from 'node:buffer'

import { locale_t, role_t, timeStamp_t } from './basedefs.ts'
import type { CharAPI_t } from './charAPI.ts'
import type { PluginAPI_t } from './pluginAPI.ts'
import type { UserAPI_t } from './userAPI.ts'
import type { WorldAPI_t } from './worldAPI.ts'

/**
 * 聊天回复（角色/agent 输出）。
 * 权威形状与 `shells/chat/src/chat/session/models.mjs` 一致。
 */
export class chatReply_t {
	name?: string
	avatar?: string
	content: string
	content_for_show?: string
	content_for_edit?: string
	locale?: string
	content_warning?: string
	sensitive_media?: boolean
	files?: {
		name: string
		mime_type: string
		buffer: Buffer
		description: string
	}[]
	logContextBefore?: chatLogEntry_t[]
	logContextAfter?: chatLogEntry_t[]
	charVisibility?: string[]
	extension?: Record<string, unknown>
}

/**
 * 最终 AI 源处理的回复预览更新器。
 */
export type ReplyPreviewUpdater_t = (reply: chatReply_t) => void

/**
 * 角色处理中回复预览更新器（含完整请求上下文）。
 */
export type CharReplyPreviewUpdater_t = (
	args: chatReplyRequest_t,
	reply: chatReply_t,
) => void

/**
 * 生成选项中的回复预览钩子。
 */
export type GenerationOptions_t = {
	replyPreviewUpdater?: ReplyPreviewUpdater_t
	signal?: AbortSignal
	supported_functions?: {
		markdown?: boolean
		mathjax?: boolean
		html?: boolean
		unsafe_html?: boolean
		files?: boolean
		add_message?: boolean
		fount_i18nkeys?: boolean
		fount_assets?: boolean
		fount_themes?: boolean
	}
	base_result?: {
		content: string
		files: {
			name: string
			mime_type: string
			buffer: Buffer
			description: string
		}[]
		extension?: object
	}
}

/**
 * RPG 分支上下文（持久化在 `chatLogEntry_t.extension.timeSlice`）。
 */
export interface ChatLogTimeSlice {
	chars: Record<string, CharAPI_t>
	plugins: Record<string, PluginAPI_t>
	world: WorldAPI_t
	world_id?: string
	player: UserAPI_t
	player_id?: string
	chars_speaking_frequency?: Record<string, number>
	charname?: string
	playername?: string
	greeting_type?: string
	summary?: string
}

/**
 * 统一观察者身份：world / persona 视图分发以此为准，不再以 username/charname 特判。
 */
export type chatViewer_t = {
	kind: 'user' | 'char'
	memberId: string
	ownerUsername: string
	channelId: string
	charname?: string
	roles?: string[]
	entityHash?: string
}

/**
 * 频道消息附件（发帖 / BeforeUserSend）。
 */
export type file_t = {
	name?: string
	mime_type?: string
	buffer: Buffer | string
	description?: string
}

/**
 * 水合后 chatLog 壳层侧车（`extension.chat`）。DAG wire 类型见 `shells/chat/decl/channelWire.ts`。
 */
export type chatLogChatExtension_t = {
	eventId?: string
	entryId?: string
	channelId?: string
	attribution?: Record<string, unknown>
	display?: { name?: string | null, avatar?: string | null }
	bridge?: Record<string, unknown>
	replyTo?: { eventId: string, senderName?: string, preview?: string, senderEntityHash?: string }
	virtualEventId?: string
	isGreeting?: boolean
	aborted?: boolean
	[key: string]: unknown
}

/**
 * 聊天回复请求（Part API / GetReply 上下文）。
 */
export class chatReplyRequest_t {
	supported_functions: {
		markdown: boolean
		mathjax: boolean
		html: boolean
		unsafe_html: boolean
		files: boolean
		add_message: boolean
		fount_i18nkeys: boolean
		fount_assets: boolean
		fount_themes: boolean
	}
	chat_name: string
	char_id: string
	username: string
	Charname: string
	UserCharname: string
	ReplyToCharname?: string
	/** 本机主人说话人身份（operator entityHash 等）。禁止填消息作者 / 陌生人。 */
	UserUid: string
	/** 当前角色说话人身份（agent entityHash 等） */
	CharUid: string
	/** 当前回复对象说话人身份（可选；可为陌生人） */
	ReplyToUid?: string
	locales: locale_t[]
	time: timeStamp_t
	chat_log: chatLogEntry_t[]
	timelines: chatLogEntry_t[]
	/** 当前 viewer 在群内的角色 id 列表（供 prompt visibility 等使用） */
	member_roles?: string[]
	AddChatLogEntry?: (entry: chatReply_t) => Promise<chatLogEntry_t>
	Update?: () => Promise<chatReplyRequest_t>
	world: WorldAPI_t
	user: UserAPI_t
	char: CharAPI_t
	other_chars: Record<string, CharAPI_t>
	/** 群内其他用户的 persona（本机 user 槽之外的他者贡献） */
	other_personas?: Record<string, UserAPI_t>
	plugins: Record<string, PluginAPI_t>
	chat_summary: string
	/** 角色在本频道（char×频道 键控）的本地私域记忆：请求传入后角色/插件就地 mutate，生成结束由 chat 引擎快照写回本机；不上 DAG / 不联邦复制。 */
	chat_scoped_char_memory: object
	extension: object
	/** 请求级 AI 源覆盖（已实例化的 `serviceSources/AI` 部件，调用方负责 loadPart）。缺省/无效值时角色使用自身配置的 AI 源。 */
	ai_source?: import('./AIsource.ts').AIsource_t<any, any>
	/** 请求级默认目标机器与工作目录（代码执行 / 文件读写等功能的默认目标）。machine 为目标机器标识（当前为 subfount 数字 id 的十进制字符串，"0"=本机；保留 string 以便未来扩展）。由调用方（shell 等请求构建者）创建传入；char 可传给插件就地 mutate 字段，生成结束由 chat 引擎按 char×频道 快照写回本机。用户无需感知其内部结构。 */
	workdir?: { machine?: string, path: string }
	generation_options?: GenerationOptions_t
}

/**
 * 聊天日志条目。
 * RPG 分支上下文存于 `extension.timeSlice`；壳层侧车存于 `extension.chat`。
 */
export class chatLogEntry_t {
	id: string
	name: string
	/** 说话人身份（宿主自定义；与消息 id 无关） */
	uid: string
	avatar: string
	time_stamp: timeStamp_t
	role: role_t
	content: string
	content_for_show?: string
	content_for_edit?: string
	locale?: string
	content_warning?: string
	sensitive_media?: boolean
	is_generating?: boolean
	files?: {
		name: string
		mime_type: string
		buffer: Buffer | string
		description: string
		extension?: object
	}[]
	logContextBefore?: chatLogEntry_t[]
	logContextAfter?: chatLogEntry_t[]
	charVisibility?: string[]
	extension: {
		timeSlice?: ChatLogTimeSlice
		feedback?: { type: 'up' | 'down', content?: string }
		chat?: chatLogChatExtension_t
		[key: string]: unknown
	}
}

/** 聊天日志条目数组。 */
export type chatLog_t = chatLogEntry_t[]
