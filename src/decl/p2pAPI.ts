/**
 * P2P 群聊类型定义（与 `src/scripts/p2p/`、`chat/src/chat/dag/index.mjs` 对齐）
 */

/** GSH 密文信封（§11） */
export interface GshContentEnvelope {
	scheme: 'gsh'
	generation: number
	iv: string
	ciphertext: string
	authTag: string
}

/** 外链正文（签名域须含 hash 字段，§6） */
export interface ContentRef {
	contentHash: string
	alg: string
	byteLength: number
	storageLocator: string
}

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
	prev_event_ids: string[]
	content: Record<string, unknown> | GshContentEnvelope
	signature: string
	senderPubKey?: string
	node_id?: string
}

/**
 * 群组状态
 */
export interface GroupState {
	groupId: string
	members: Record<string, Member>
	membersRoot: string | null
	membersPagesCount: number
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
	bannedEntities: Set<string>
	bannedNodes: Set<string>
	delegatedOwnerPubKeyHash?: string | null
	dagTips?: string[]
	consensusBranchTip?: string | null
	localViewBranchTip?: string | null
	governanceFork?: boolean
	walOk?: boolean
	walReason?: string
}

/**
 * 成员
 */
export interface Member {
	pubKeyHash: string
	homeNodeHash?: string | null
	roles: string[]
	joinedAt: number
	status: 'active' | 'left' | 'kicked' | 'banned'
	repEdgeFromIntroducer?: number
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
	description: string
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
	description: string
	avatar: string | null
	forkedFrom?: string
	forkBranchTip?: string
	forkedAt?: number
}

/**
 * 群组设置
 */
export interface GroupSettings {
	defaultChannelId: string
	joinPolicy: 'invite-only' | 'pow'
	powDifficulty: number
	fileSizeLimit: number
	fileQuotaBytes: number
	fileUploadPolicy: 'all_members' | 'role_gated'
	fileReplicationFactor?: number
	lateMessageFreezeMs?: number
	autoReplyFrequency?: number
	hlcMaxSkewMs?: number
	maxDagPayloadBytes?: number
	streamGeneratingIdleMs?: number
	streamingSfuWss?: string | null
	maxPeers?: number
	trustedPeerSlots?: number
	explorePeerSlots?: number
	gossipTtl?: number
	wantIdsBudget?: number
	batterySaver?: boolean
	event_retention_depth?: number
	event_retention_ms?: number
	slashAlertTtl?: number
}

/**
 * 消息覆盖层
 */
export interface MessageOverlay {
	deletedIds: Set<string>
	editHistory: Map<string, unknown>
	reactions: Map<string, Set<string>>
	pins: Map<string, string[]>
	fileIndex: Map<string, FileInfo>
	votes: Map<string, Map<string, string>>
}

/**
 * 文件索引（密钥由 GSH KDF 推导，§10.3；不存 aesKey）
 */
export interface FileInfo {
	name: string
	size: number
	mimeType: string
	folderId: string | null
	chunkManifest: ChunkInfo[]
	storageLocator?: string
	deleted?: boolean
	key_generation?: number
}

/**
 * 块信息
 */
export interface ChunkInfo {
	chunkIndex: number
	chunkHash: string
	storageLocator: string
	ivHex?: string
}

/**
 * Checkpoint
 */
export interface Checkpoint {
	local_node_id: string | null
	members_record: {
		groupId: string
		members: Record<string, Member>
		roles: Record<string, Role>
		channelPermissions: Record<string, Record<string, ChannelPermissionOverride>>
		channels: Record<string, Channel>
		fileFolders: Record<string, FileFolder>
		groupMeta: GroupMeta
		groupSettings: GroupSettings
		messageOverlay: {
			deletedIds: string[]
			editHistory: [string, unknown][]
			reactions: Record<string, string[]>
			pins: [string, string[]][]
			fileIndex: [string, FileInfo][]
		}
		bannedMembers: string[]
		membersRoot: string | null
		membersPagesCount: number
	}
	epoch_id: number
	checkpoint_event_id: string | null
	eventIdsInEpoch: string[]
	epoch_root_hash: string | null
	local_tips_hash: string | null
	dag_tip_ids: string[]
	overlay: Checkpoint['members_record']['messageOverlay']
	fileFolders: Record<string, FileFolder>
	epoch_chain: object[]
	created_at?: number
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
