/**
 * P2P 群聊类型定义
 */

/**
 * DAG 事件类型
 */
export interface DAGEvent {
	id: string
	type: string
	groupId: string
	channelId?: string
	sender: string
	charId?: string
	timestamp: number
	hlc: {
		wall: number
		logical: number
	}
	prev_event_id: string | null
	content: any
	signature: string
	received_at?: number
	isRemote?: boolean
}

/**
 * 群组状态
 */
export interface GroupState {
	groupId: string
	home_node_id: string | null
	members: Record<string, Member>
	members_root: string | null
	members_pages_count: number
	roles: Record<string, Role>
	channelPermissions: Record<string, Record<string, ChannelPermissionOverride>>
	channels: Record<string, Channel>
	fileFolders: Record<string, FileFolder>
	groupMeta: GroupMeta
	groupSettings: GroupSettings
	messageOverlay: MessageOverlay
	checkpoint_event_id: string | null
	epoch_id: number
	epoch_root_hash: string | null
	bannedMembers: Set<string>
}

/**
 * 成员
 */
export interface Member {
	pubKeyHash: string
	roles: string[]
	joinedAt: number
	status: 'active' | 'left' | 'kicked' | 'banned'
}

/**
 * 角色
 */
export interface Role {
	name: string
	color: string
	position: number
	permissions: Record<string, boolean>
	isDefault: boolean
	isHoisted: boolean
}

/**
 * 频道权限覆写
 */
export interface ChannelPermissionOverride {
	allow: Record<string, boolean>
	deny: Record<string, boolean>
}

/**
 * 频道
 */
export interface Channel {
	id: string
	type: 'text' | 'list' | 'streaming'
	name: string
	desc: string
	parentChannelId: string | null
	syncScope: 'group' | 'channel'
	isPrivate: boolean
	subRoomId?: string
	createdAt: number
	manualItems?: ListItem[]
}

/**
 * 列表项
 */
export interface ListItem {
	title: string
	desc?: string
	targetChannelId?: string
	url?: string
}

/**
 * 文件夹
 */
export interface FileFolder {
	name: string
	parentFolderId: string | null
}

/**
 * 群组元数据
 */
export interface GroupMeta {
	name: string
	desc: string
	avatar: string | null
}

/**
 * 群组设置
 */
export interface GroupSettings {
	defaultChannelId: string
	joinPolicy: 'open' | 'invite-only' | 'pow'
	powDifficulty: number
	fileSizeLimit: number
	fileQuotaBytes: number
	fileUploadPolicy: 'all_members' | 'role_gated'
	fileReplicationFactor?: number
	homeCheckpointStaleDays?: number
	lateMessageFreezeMs?: number
}

/**
 * 消息覆盖层
 */
export interface MessageOverlay {
	deletedIds: Set<string>
	editHistory: Map<string, any>
	reactionCounts: Map<string, number>
	pins: Map<string, string[]>
	fileIndex: Map<string, FileInfo>
}

/**
 * 文件信息
 */
export interface FileInfo {
	aesKey: Uint8Array
	name: string
	size: number
	mimeType: string
	folderId: string | null
	chunkManifest: ChunkInfo[]
}

/**
 * 块信息
 */
export interface ChunkInfo {
	chunkIndex: number
	chunkHash: string
	storageLocator: string
}

/**
 * Checkpoint
 */
export interface Checkpoint {
	groupId: string
	home_node_id: string | null
	members_root: string | null
	members_pages_count: number
	members_page_0?: Member[]
	roles: Record<string, Role>
	channelPermissions: Record<string, Record<string, ChannelPermissionOverride>>
	channels: Record<string, Channel>
	fileFolders: Record<string, FileFolder>
	groupMeta: GroupMeta
	groupSettings: GroupSettings
	messageOverlay: {
		deletedIds: string[]
		editHistory: [string, any][]
		reactionCounts: [string, number][]
		pins: [string, string[]][]
		fileIndex: [string, FileInfo][]
	}
	checkpoint_event_id: string | null
	epoch_id: number
	epoch_root_hash: string | null
	created_at: number
}

/**
 * PoW 挑战
 */
export interface PowChallenge {
	challenge: string
	difficulty: number
	timestamp: number
}

/**
 * PoW 解决方案
 */
export interface PowSolution {
	nonce: number
	hash: string
}
