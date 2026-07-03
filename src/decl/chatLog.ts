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
	locales: locale_t[]
	time: timeStamp_t
	chat_log: chatLogEntry_t[]
	timelines: chatLogEntry_t[]
	AddChatLogEntry?: (entry: chatReply_t) => Promise<chatLogEntry_t>
	Update?: () => Promise<chatReplyRequest_t>
	world: WorldAPI_t
	user: UserAPI_t
	char: CharAPI_t
	other_chars: Record<string, CharAPI_t>
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
	avatar: string
	time_stamp: timeStamp_t
	role: role_t
	content: string
	content_for_show?: string
	content_for_edit?: string
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
