import { Buffer } from 'node:buffer'

import { info_t } from '../../../../../decl/basedefs.ts'

/** ---- Channels（原 channelAPI.ts）---- */

/**
 *
 */
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

/**
 *
 */
export type ChannelRole = 'owner' | 'admin' | 'moderator' | 'member' | 'subscriber'

/**
 *
 */
export type ChannelType = 'announcement' | 'news' | 'updates'

/**
 *
 */
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

/**
 *
 */
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

/**
 *
 */
export interface ChannelMember {
	username: string
	role: ChannelRole
	joinedAt: number
}

/**
 *
 */
export class ChannelAPI_t {
	info: info_t

	Init?: () => Promise<void>
	Load?: () => Promise<void>
	Unload?: (reason: string) => Promise<void>

	interfaces?: {
		createChannel?: (username: string, config: Partial<ChannelConfig>) => Promise<ChannelConfig>
		getChannelList?: (username: string) => Promise<ChannelConfig[]>
		getChannel?: (channelId: string) => Promise<ChannelConfig>
		updateChannel?: (channelId: string, updates: Partial<ChannelConfig>) => Promise<ChannelConfig>
		deleteChannel?: (channelId: string) => Promise<void>
		subscribe?: (username: string, channelId: string) => Promise<void>
		unsubscribe?: (username: string, channelId: string) => Promise<void>
		postMessage?: (channelId: string, message: Partial<ChannelMessage>) => Promise<ChannelMessage>
		getMessages?: (channelId: string, start?: number, limit?: number) => Promise<ChannelMessage[]>
		checkPermission?: (username: string, channelId: string, permission: ChannelPermission) => Promise<boolean>
		getUserRole?: (username: string, channelId: string) => Promise<ChannelRole | null>
	}
}

/** ---- Profile（原 profileAPI.ts）---- */

/**
 *
 */
export type UserStatus = 'online' | 'away' | 'busy' | 'offline'

/**
 *
 */
export interface UserProfile {
	username: string
	displayName: string
	avatar?: string
	bio?: string
	email?: string
	status: UserStatus
	customStatus?: string
	preferences: {
		language: string
		theme: string
		notifications: {
			email: boolean
			push: boolean
			sound: boolean
		}
	}
	social?: {
		website?: string
		github?: string
		twitter?: string
	}
	stats: {
		joinedAt: number
		messageCount: number
		groupCount: number
		channelCount: number
	}
	privacy: {
		showEmail: boolean
		showStats: boolean
		allowDirectMessages: boolean
	}
}

/**
 *
 */
export class ProfileAPI_t {
	info: info_t

	Init?: () => Promise<void>
	Load?: () => Promise<void>
	Unload?: (reason: string) => Promise<void>

	interfaces?: {
		getProfile?: (username: string) => Promise<UserProfile>
		updateProfile?: (username: string, updates: Partial<UserProfile>) => Promise<UserProfile>
		uploadAvatar?: (username: string, file: Buffer, filename: string) => Promise<string>
		getStats?: (username: string) => Promise<UserProfile['stats']>
		updateStatus?: (username: string, status: UserStatus, customStatus?: string) => Promise<void>
	}
}

/** ---- Stickers（原 stickerAPI.ts）---- */

/**
 *
 */
export interface Sticker {
	id: string
	name: string
	url: string
	tags: string[]
	animated: boolean
}

/**
 *
 */
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

/**
 *
 */
export interface UserStickerCollection {
	username: string
	installedPacks: string[]
	favoriteStickers: string[]
	recentStickers: string[]
}

/**
 *
 */
export interface StickerMessage {
	type: 'sticker'
	packId: string
	stickerId: string
	url: string
}

/**
 *
 */
export class StickerAPI_t {
	info: info_t

	Init?: () => Promise<void>
	Load?: () => Promise<void>
	Unload?: (reason: string) => Promise<void>

	interfaces?: {
		getStickerPacks?: (username?: string) => Promise<StickerPack[]>
		createStickerPack?: (username: string, pack: Partial<StickerPack>) => Promise<StickerPack>
		getStickerPack?: (packId: string) => Promise<StickerPack>
		updateStickerPack?: (packId: string, updates: Partial<StickerPack>) => Promise<StickerPack>
		deleteStickerPack?: (packId: string) => Promise<void>
		uploadSticker?: (packId: string, file: Buffer, filename: string, metadata: Partial<Sticker>) => Promise<Sticker>
		deleteSticker?: (packId: string, stickerId: string) => Promise<void>
		installPack?: (username: string, packId: string) => Promise<void>
		uninstallPack?: (username: string, packId: string) => Promise<void>
		getUserCollection?: (username: string) => Promise<UserStickerCollection>
		addToFavorites?: (username: string, stickerId: string) => Promise<void>
		removeFromFavorites?: (username: string, stickerId: string) => Promise<void>
		recordRecentUse?: (username: string, stickerId: string) => Promise<void>
	}
}
