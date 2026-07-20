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
	chars_memories?: Record<string, unknown>
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
 * 频道消息 content（与 `public/shared/channelContent.mjs` 对齐；允许扩展字段）。
 */
export type channelMessageContent_t = {
	type: 'text' | 'sticker' | 'vote' | 'group_invite'
	content?: string
	content_for_show?: string
	content_for_edit?: string
	displayName?: string
	displayAvatar?: string
	fileIds?: string[]
	fileCount?: number
	isAutoTrigger?: boolean
	locale?: string
	content_warning?: string
	sensitive_media?: boolean
	forwardedFrom?: {
		groupId: string
		channelId: string
		eventId: string
		senderName?: string
		shareUrl?: string
	}
	fileAlts?: Record<string, string>
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
	chat_scoped_char_memory: object
	extension: object
	generation_options?: GenerationOptions_t
}

/**
 * 聊天日志条目。
 * RPG 分支上下文存于 `extension.timeSlice`。
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
		dagEventId?: string
		chatLogEntryId?: string
		[key: string]: unknown
	}
}

/**
 *
 */
export type chatLog_t = chatLogEntry_t[]
