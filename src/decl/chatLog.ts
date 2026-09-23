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
 * `AddChatLogEntry` 的可追加条目：在角色回复形状之上允许携带任意条目字段（`role` / `type` / `uid` / `charVisibility` 等），
 * 使角色与插件能追加任意日志条目，而非一律被规整为角色回复。
 */
export type chatLogAppendInput_t = chatReply_t & {
	id?: string
	uid?: string
	role?: role_t
	type?: string
	visibility?: { roles?: string[], members?: string[] }
	time_stamp?: timeStamp_t
	is_generating?: boolean
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
 * 工具执行实时输出事件（`GenerationOptions_t.onToolOutput` 的载荷）。
 *
 * 一次 `<run-*>` / `<inline-*>` 调用产生一串事件：`start`（携带代码/语言）→ 若干 `chunk`（stdout/stderr 分片）→ `end`。
 * `callId` 在一次调用内稳定，供前端把分片归并到同一张实时工具卡。
 */
export type ToolOutputEvent_t = {
	/** 本次调用的稳定 id（同一调用的各分片一致）。 */
	callId: string
	/** 事件阶段。 */
	phase: 'start' | 'chunk' | 'end'
	/** 工具名（如 `code-execution.run-js`）。 */
	name: string
	/** 代码语言标签（`phase === 'start'` 时给出）。 */
	lang?: string
	/** 代码原文（`phase === 'start'` 时给出）。 */
	code?: string
	/** 输出通道（`phase === 'chunk'` 时给出）。 */
	stream?: 'stdout' | 'stderr'
	/** 输出分片文本（`phase === 'chunk'` 时给出）。 */
	data?: string
}

/**
 * 生成选项中的回复预览钩子。
 */
export type GenerationOptions_t = {
	replyPreviewUpdater?: ReplyPreviewUpdater_t
	/**
	 * 工具执行实时输出钩子：code-execution 等插件在执行 `<run-*>` / `<inline-*>` 时逐块回调。
	 * 缺省 undefined 时不流式；交互壳（如 code shell）设置后经自身通道转发到前端。
	 */
	onToolOutput?: (event: ToolOutputEvent_t) => void
	/** 远程流式回显时，主机侧实现 `interfaces.subfount.RemoteCallBack` 的 partpath（仅在同时设置 `onToolOutput` 时使用）。 */
	remoteToolCallbackPartpath?: string
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
	/**
	 * 稳定且频道唯一的会话标识，由请求构造方（shell）负责保证：
	 * 用于 Agent Studio 把生成记录归入同一对话并按消息 id 复原。未提供时主动记录 API 只告警、不记录。
	 */
	chat_id?: string
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
	/**
	 * 追加一条日志条目。`role === 'char'`（或缺省）走角色回复规整；其余 role 按原样追加，并通知 shell 安排一次生成。
	 * 条目带 `charVisibility` 时仅本地角色可见，shell 不应写入 DAG。
	 */
	AddChatLogEntry?: (entry: chatLogAppendInput_t) => Promise<chatLogEntry_t>
	Update?: () => Promise<chatReplyRequest_t>
	/**
	 * 清除本频道待触发的生成队列：shell 的轮次刷新（`Update` / container 封存）已让角色看到新内容，无需再补一次生成。
	 */
	ClearPendingMessages?: () => void
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
	workdir?: { machine?: string, path?: string }
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
	/** 条目类型标记（如 `'summary'` 表示上下文压缩摘要） */
	type?: string
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

/** 上下文压缩摘要条目的模型标记（同时用作条目 `name` 与 `type`）。 */
export const SUMMARY_ENTRY_TYPE = 'summary'

/**
 * 容器条目的模型标记：自身不贡献 chat log，只展开其 `logContextBefore` / `logContextAfter`。
 * 用于在轮次刷新时把已累积的追加上下文“封存”为一个锚点，保证后续新条目的时序正确。
 */
export const CONTAINER_ENTRY_TYPE = 'container'

/**
 * 问候条目的模型标记前缀：`type` 形如 `greeting:<subtype>`（subtype 为 `single` / `group` / `world_single` / `world_group`）。
 * 取代旧的 `extension.timeSlice.greeting_type`，使特殊条目统一由 `type` 判定。
 */
export const GREETING_ENTRY_TYPE = 'greeting'

/**
 * 由问候子类型构造条目的 `type` 值。
 * @param {string} subtype 问候子类型
 * @returns {string} `greeting:<subtype>`
 */
export function greetingEntryType(subtype: string): string {
	return `${GREETING_ENTRY_TYPE}:${subtype}`
}

/**
 * 判断条目是否为摘要条目。
 * @param {chatLogEntry_t} entry 日志条目
 * @returns {boolean} 是否为摘要条目
 */
export function isSummaryEntry(entry: chatLogEntry_t): boolean {
	return entry.type === SUMMARY_ENTRY_TYPE
}

/**
 * 判断条目是否为容器条目（自身不贡献 log，只展开前后追加内容）。
 * @param {chatLogEntry_t} entry 日志条目
 * @returns {boolean} 是否为容器条目
 */
export function isContainerEntry(entry: chatLogEntry_t): boolean {
	return entry.type === CONTAINER_ENTRY_TYPE
}

/**
 * 判断条目是否为问候条目。
 * @param {chatLogEntry_t} entry 日志条目
 * @returns {boolean} 是否为问候条目
 */
export function isGreetingEntry(entry: chatLogEntry_t): entry is chatLogEntry_t & { type: string } {
	return typeof entry?.type === 'string' && entry.type.startsWith(`${GREETING_ENTRY_TYPE}:`)
}

/**
 * 取问候条目的子类型。
 * @param {chatLogEntry_t} entry 日志条目
 * @returns {string | null} 子类型；非问候条目为 null
 */
export function greetingSubtypeOf(entry: chatLogEntry_t): string | null {
	return isGreetingEntry(entry) ? entry.type.slice(GREETING_ENTRY_TYPE.length + 1) : null
}

/** 聊天日志条目数组。 */
export type chatLog_t = chatLogEntry_t[]
