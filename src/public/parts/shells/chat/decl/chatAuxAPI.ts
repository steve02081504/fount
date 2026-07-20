/** ---- Channels（数据形状；运行时见 `groupChannel.mjs` / `channels.mjs`）---- */

/** 频道内单项操作权限标识（与 DAG 角色/订阅者列表对照）。 */
export type ChannelPermission =
	| 'canPost'
	| 'canEdit'
	| 'canDelete'
	| 'canPin'
	| 'canInvite'
	| 'canRemove'
	| 'canManageRoles'
	| 'canEditChannel'
	| 'canDeleteChannel'
	| 'canViewHistory'

/** 频道成员角色层级（owner → subscriber）。 */
export type ChannelRole = 'owner' | 'admin' | 'moderator' | 'member' | 'subscriber'

/** 运行时 DAG 频道类型（见 `src/group/routes/channels.mjs`）。 */
export type ChannelType = 'text' | 'list' | 'streaming'

/** 频道配置快照（物化自 DAG channel_* 事件）。 */
export interface ChannelConfig {
	channelId: string
	name: string
	description: string
	avatar?: string
	type: ChannelType
	owner: string
	admins: string[]
	subscribers: string[]
	permissions: {
		canPost: string[]
		canComment: boolean
		isPublic: boolean
	}
	createdAt: number
	updatedAt: number
}

/** 频道内单条消息（文本/附件/置顶状态）。 */
export interface ChannelMessage {
	messageId: string
	channelId: string
	author: string
	content: string
	files?: Array<{
		name: string
		url: string
		type: string
	}>
	isPinned: boolean
	createdAt: number
	updatedAt?: number
}

/** 频道成员及其角色与加入时间。 */
export interface ChannelMember {
	username: string
	role: ChannelRole
	joinedAt: number
}

/** ---- Profile（数据形状）---- */

/** 实体在线/勿扰等展示状态。 */
export type UserStatus = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline' | 'away' | 'busy'

/**
 * 资料外链（各 locale 切片内）。
 */
export interface ProfileLink {
	icon?: string
	name?: string
	url: string
}

/**
 * 单 locale 资料切片：与 `single_lang_info_t` 同名字段 + `links`。
 */
export type ProfileLocaleSlice = Partial<import('../../../../../decl/basedefs.ts').single_lang_info_t> & {
	links?: ProfileLink[]
}

/**
 * 实体资料（磁盘与 API 持久化形态）。
 */
export interface UserProfile {
	entityHash: string
	nodeHash: string
	subjectHash: string
	/** 可选网络搜索 handle */
	handle?: string
	/** 资料卡横幅主题色 `#rrggbb` */
	themeColor?: string
	/** 自定义横幅图 URL；空串回退主题色纹理 */
	banner?: string
	/** 多语言展示字段，键为 locale（如 `zh-CN`） */
	localized: Record<string, ProfileLocaleSlice>
	status: UserStatus
	customStatus?: string
	lastSeenAt?: number
	stats: {
		joinedAt: number
		messageCount: number
		groupCount: number
		channelCount: number
	}
}

/**
 * GET 时在持久化字段之上附加的解析结果（当前查看者 locale）。
 */
export interface UserProfilePresentation extends UserProfile {
	name: string
	avatar: string
	description: string
	description_markdown: string
	version: string
	author: string
	home_page: string
	issue_page: string
	tags: string[]
	links: ProfileLink[]
	effectiveStatus?: UserStatus
	infoDefaults?: ProfileLocaleSlice & { links: ProfileLink[] }
	localeKeys?: string[]
}

/** ---- Stickers（数据形状；运行时见 `stickers/`）---- */

/** 贴纸包内单个贴纸资源。 */
export interface Sticker {
	id: string
	name: string
	url: string
	tags: string[]
	animated: boolean
}

/** 贴纸包元数据与所含贴纸列表。 */
export interface StickerPack {
	packId: string
	name: string
	author: string
	description: string
	thumbnail?: string
	stickers: Sticker[]
	isPublic: boolean
	createdAt: number
	updatedAt: number
}

/** 用户已安装/收藏/最近使用的贴纸集合。 */
export interface UserStickerCollection {
	entityHash: string
	installedPacks: string[]
	favoriteStickers: string[]
	recentStickers: string[]
}

/** 聊天消息中的贴纸载荷（type=sticker）。 */
export interface StickerMessage {
	type: 'sticker'
	packId: string
	stickerId: string
	url: string
}
