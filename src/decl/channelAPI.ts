import { info_t } from './basedefs.ts'

/**
 * 频道权限类型
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
 * 频道角色类型
 */
export type ChannelRole = 'owner' | 'admin' | 'moderator' | 'member' | 'subscriber'

/**
 * 频道类型
 */
export type ChannelType = 'announcement' | 'news' | 'updates'

/**
 * 频道配置接口
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
 * 频道消息接口
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
 * 频道成员接口
 */
export interface ChannelMember {
	username: string
	role: ChannelRole
	joinedAt: number
}

/**
 * 频道 API 接口
 */
export class ChannelAPI_t {
	info: info_t

	Init?: () => Promise<void>
	Load?: () => Promise<void>
	Unload?: (reason: string) => Promise<void>

	interfaces?: {
		/**
		 * 创建频道
		 */
		createChannel?: (username: string, config: Partial<ChannelConfig>) => Promise<ChannelConfig>

		/**
		 * 获取频道列表
		 */
		getChannelList?: (username: string) => Promise<ChannelConfig[]>

		/**
		 * 获取频道详情
		 */
		getChannel?: (channelId: string) => Promise<ChannelConfig>

		/**
		 * 更新频道设置
		 */
		updateChannel?: (channelId: string, updates: Partial<ChannelConfig>) => Promise<ChannelConfig>

		/**
		 * 删除频道
		 */
		deleteChannel?: (channelId: string) => Promise<void>

		/**
		 * 订阅频道
		 */
		subscribe?: (username: string, channelId: string) => Promise<void>

		/**
		 * 取消订阅
		 */
		unsubscribe?: (username: string, channelId: string) => Promise<void>

		/**
		 * 发布消息
		 */
		postMessage?: (channelId: string, message: Partial<ChannelMessage>) => Promise<ChannelMessage>

		/**
		 * 获取消息列表
		 */
		getMessages?: (channelId: string, start?: number, limit?: number) => Promise<ChannelMessage[]>

		/**
		 * 检查权限
		 */
		checkPermission?: (username: string, channelId: string, permission: ChannelPermission) => Promise<boolean>

		/**
		 * 获取用户角色
		 */
		getUserRole?: (username: string, channelId: string) => Promise<ChannelRole | null>
	}
}
