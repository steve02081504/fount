/**
 * DAG 频道消息线格式（仅 chat shell）。
 * 与 fount 根 `chatLogEntry_t` 分离：落盘紧凑、带 `type`；水合后再变 fount 面。
 */

/**
 * 落盘附件引用（fileId 仅存储层）。
 */
export type channelWireFile_t = {
	fileId: string
	name: string
	mime_type: string
	size: number
	description?: string
}

/**
 * 落盘壳层侧车（不含 sticker/vote/call/invite——那些用顶层 type）。
 */
export type channelWireChatExt_t = {
	sessionSnapshot?: object
	entryId?: string
	isAutoTrigger?: boolean
	replyTo?: { eventId: string, senderName?: string, preview?: string }
	forwardedFrom?: {
		groupId: string
		channelId: string
		eventId: string
		senderName?: string
		shareUrl?: string
	}
	importedFrom?: Record<string, unknown>
	contentRef?: Record<string, unknown>
	bridge?: Record<string, unknown>
	[key: string]: unknown
}

type channelWireCommon_t = {
	name?: string
	avatar?: string
	role?: string
	locale?: string
	content_warning?: string
	sensitive_media?: boolean
	is_generating?: boolean
	charVisibility?: string[]
	visibility?: unknown
	files?: channelWireFile_t[]
	extension?: { chat?: channelWireChatExt_t, [key: string]: unknown }
}

/**
 * 文本消息（wire 上省略 `type` 以省内存；缺省即 text）。
 */
export type channelWireText_t = channelWireCommon_t & {
	type?: 'text'
	content: string
	content_for_show?: string
	content_for_edit?: string
}

/**
 * 贴纸（无正文时省略 content）。
 */
export type channelWireSticker_t = channelWireCommon_t & {
	type: 'sticker'
	emoji?: string
	stickerId?: string
	stickerName?: string
	stickerBase64?: string
	mimeType?: string
}

/**
 * 投票（计票字段顶层，便于频道密钥明文保留）。
 */
export type channelWireVote_t = channelWireCommon_t & {
	type: 'vote'
	question: string
	options: string[]
	deadline?: number | string
}

/**
 * 群邀请卡片。
 */
export type channelWireGroupInvite_t = channelWireCommon_t & {
	type: 'group_invite'
	groupId: string
	inviteCode?: string
	groupName?: string
	description?: string
	memberCount?: number
}

/**
 * 通话卡片。
 */
export type channelWireCall_t = channelWireCommon_t & {
	type: 'call'
	callId: string
	status: 'ongoing' | 'ended' | string
	startedAt?: number
	endedAt?: number
	duration?: number
	initiator?: string
	participants?: string[]
	current?: string[]
}

/**
 * DAG `message` / `message_edit.newContent` 线载荷。
 */
export type channelWireMessage_t =
	| channelWireText_t
	| channelWireSticker_t
	| channelWireVote_t
	| channelWireGroupInvite_t
	| channelWireCall_t
