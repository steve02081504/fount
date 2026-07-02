/**
 * P2P 基础设施与 Chat 群物化状态类型（与 `src/scripts/p2p/`、`shells/chat/src/chat/dag/` 对齐）。
 *
 * Chat 专用会话类型见 `src/decl/chatLog.ts`；Social 时间线见 `src/decl/socialAPI.ts`。
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

/** DAG 事件（Chat 群 WAL / Social 时间线共用骨架） */
export interface DAGEvent {
	id: string
	type: string
	groupId: string
	channelId?: string
	/** 发送者 pubKeyHash（验签 canonical 域） */
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
	/** 联邦入站附带的 Ed25519 公钥 hex */
	senderPubKey?: string
	node_id?: string
}

/** checkpoint `epoch_chain` 单条 */
export interface EpochChainEntry {
	epoch_id: number
	epoch_root_hash: string
	checkpoint_event_id: string
}

/** 物化群会话（agent char / world / persona 绑定） */
export interface GroupSessionState {
	chars: Record<string, { ownerUsername: string, homeNodeHash: string }>
	world: string | null
	channelWorlds: Record<string, string>
	personas: Record<string, unknown>
	plugins: Record<string, unknown>
	charFrequencies: Record<string, number>
}

// ---- Permissions（`scripts/p2p/permissions.mjs`）----

/** 内置权限名；持久化位图顺序见 `PERMISSION_ORDER`，禁止重排。 */
export type PermissionName =
	| 'VIEW_CHANNEL'
	| 'SEND_MESSAGES'
	| 'SEND_STICKERS'
	| 'ADD_REACTIONS'
	| 'MANAGE_MESSAGES'
	| 'MANAGE_CHANNELS'
	| 'KICK_MEMBERS'
	| 'BAN_MEMBERS'
	| 'MANAGE_ROLES'
	| 'MANAGE_ADMINS'
	| 'INVITE_MEMBERS'
	| 'STREAM'
	| 'CREATE_THREADS'
	| 'UPLOAD_FILES'
	| 'MANAGE_FILES'
	| 'PIN_MESSAGES'
	| 'ADMIN'
	| 'BYPASS_RATE_LIMIT'

/** 角色/频道覆写使用的权限 Record（运行时求值入口）。 */
export type PermissionFlags = Record<PermissionName, boolean>

/**
 * 权限位图：`encodePermissions` / `decodePermissions` 在 `permissions.mjs` 中与上式互转。
 * 仅用于内存求值与 checkpoint 内部存储，JSON 序列化时用 PermissionFlags Record。
 */
export type PermissionBitmap = bigint

// ---- Denylist（节点级 P2P 基础设施，`denylist.mjs`）----

/**
 *
 */
export type DenyScope = 'subject' | 'entity' | 'node'

/** 磁盘/API 单条 denylist 条目。 */
export interface DenylistEntry {
	scope: DenyScope
	value: string
	/** 群 scope 或 `*`（全局）；entity scope 索引层忽略 groupId */
	groupId?: string
}

/** 序列化 denylist 文件体。 */
export interface SerializedDenylist {
	blocked: DenylistEntry[]
}

// ---- 群成员 / 频道 ----

/**
 *
 */
export interface Member {
	pubKeyHash: string
	homeNodeHash?: string | null
	roles: string[]
	joinedAt: number
	status: 'active' | 'left' | 'kicked' | 'banned'
	repEdgeFromIntroducer?: number
	memberKind?: 'user' | 'agent'
	ownerPubKeyHash?: string
	charname?: string
	agentEntityHash?: string
	pubKeyHex?: string | null
}

/**
 *
 */
export interface Role {
	name: string
	color: string
	position: number
	permissions: Partial<PermissionFlags>
	isDefault: boolean
	isHoisted: boolean
}

/**
 *
 */
export interface ChannelPermissionOverride {
	allow: Partial<PermissionFlags>
	deny: Partial<PermissionFlags>
}

/**
 *
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
 *
 */
export interface ListItem {
	title: string
	desc?: string
	targetChannelId?: string
	url?: string
}

/**
 *
 */
export interface FileFolder {
	name: string
	parentFolderId: string | null
}

/**
 *
 */
export interface GroupMeta {
	name: string
	description: string
	avatar: string | null
	forkedFrom?: string
	forkBranchTip?: string
	forkedAt?: number
}

/** 群设置（JSON 字段全 camelCase，与 `group_settings_update` 一致） */
export interface GroupSettings {
	defaultChannelId: string | null
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
	eventRetentionDepth?: number
	eventRetentionMs?: number
	slashAlertTtl?: number
	federationPartitionCount?: number
	rtcConnectionBudgetMax?: number
	rtcJoinRatePerMin?: number
	messageContentRetentionMs?: number
	compactTriggerEventDepth?: number
	hotLatestMessageCount?: number
	pinContextMessageCount?: number
	dagFoldAfterArchive?: boolean
	autoPruneMessagesJsonl?: boolean
	autoPruneDagMessages?: boolean
	messageRateLimitPerMin?: number
	messageRateLimitWindowMs?: number
	iceServers?: Array<{ urls: string }>
	discoveryPublic?: boolean
	discoveryTitle?: string | null
	discoveryBlurb?: string | null
	roomSecret?: string
	autoChannelGc?: boolean
}

// ---- 信誉账本 / 邀请边 / 文件主密钥轮换 ----

/**
 *
 */
export interface ReputationLedgerEntry {
	targetPubKeyHash: string
	sender: string
	timestamp: number
	kind: 'slash' | 'reset'
	/** slash 条目指向 DAG event id */
	payloadRef?: string
}

/**
 *
 */
export interface InviteEdge {
	from: string
	to: string
	at: number
	reputationEdge?: number
	/** peer_invite 授予 GSH 时标记 */
	fileKeyWraps?: boolean
}

/**
 *
 */
export interface FileMasterKeyRotationEntry {
	eventId: string
	generation: number
	nonce: string
	type: 'kick' | 'rotate'
}

/**
 *
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
 *
 */
export interface ChunkInfo {
	chunkIndex: number
	chunkHash: string
	storageLocator: string
	ivHex?: string
}

// ---- Message overlay：运行时 vs 序列化 ----

/** 物化态 overlay（内存真相：Set / Map） */
export interface RuntimeMessageOverlay {
	deletedIds: Set<string>
	editHistory: Map<string, unknown>
	feedbackHistory: Map<string, unknown>
	reactions: Map<string, Set<string>>
	pins: Map<string, string[]>
	fileIndex: Map<string, FileInfo>
	votes: Map<string, Map<string, string>>
}

/** checkpoint / JSON 序列化 overlay */
export interface SerializedMessageOverlay {
	deletedIds: string[]
	editHistory: Record<string, unknown>
	feedbackHistory: Record<string, unknown>
	reactions: Record<string, string[]>
	pins: Record<string, string[]>
	fileIndex: Record<string, FileInfo>
	votes: Record<string, Record<string, string>>
}

/** 群物化公共字段（runtime 与 serialized 共享的标量/Record 部分） */
export interface GroupStateCore {
	groupId: string
	members: Record<string, Member>
	membersRoot: string | null
	membersPagesCount: number
	roles: Record<string, Role>
	channelPermissions: Record<string, Record<string, ChannelPermissionOverride>>
	channelKeyGeneration: Record<string, number>
	channelKeyWraps: Record<string, { generation: number }>
	channels: Record<string, Channel>
	fileFolders: Record<string, FileFolder>
	groupMeta: GroupMeta
	groupSettings: GroupSettings
	reputationLedger: ReputationLedgerEntry[]
	inviteEdges: InviteEdge[]
	fileMasterKeyRotations: FileMasterKeyRotationEntry[]
	pexHints: string[]
	messageSenderIndex: Record<string, unknown>
	session: GroupSessionState
	checkpoint_event_id: string | null
	epoch_id: number
	epoch_root_hash: string | null
	delegatedOwnerPubKeyHash?: string | null
	ownerHeartbeats: Record<string, unknown>
	dagTips?: string[]
	consensusBranchTip?: string | null
	localViewBranchTip?: string | null
	governanceFork?: boolean
	walOk?: boolean
	walReason?: string
}

/** 内存物化群状态（reducer 真相源） */
export interface RuntimeGroupState extends GroupStateCore {
	messageOverlay: RuntimeMessageOverlay
	bannedMembers: Set<string>
	bannedEntities: Set<string>
	bannedNodes: Set<string>
}

/** checkpoint `members_record` / 磁盘 JSON 形态 */
export interface SerializedGroupState extends GroupStateCore {
	messageOverlay: SerializedMessageOverlay
	bannedMembers: string[]
	bannedEntities: string[]
	bannedNodes: string[]
}

/** @deprecated 使用 {@link RuntimeGroupState} */
export type GroupState = RuntimeGroupState

/**
 *
 */
export interface CheckpointMembersRecord extends SerializedGroupState {}

/**
 *
 */
export interface Checkpoint {
	local_node_id: string | null
	members_record: CheckpointMembersRecord
	epoch_id: number
	checkpoint_event_id: string | null
	eventIdsInEpoch: string[]
	epoch_root_hash: string | null
	local_tips_hash: string | null
	dag_tip_ids: string[]
	overlay: SerializedMessageOverlay
	fileFolders: Record<string, FileFolder>
	epoch_chain: EpochChainEntry[]
	permissionAnchorHash?: string
	hot_posts?: unknown
	created_at?: number
	checkpoint_signature?: string
}

/**
 *
 */
export interface PowChallenge {
	challenge: string
	difficulty: number
	timestamp: number
}

/**
 *
 */
export interface PowSolution {
	nonce: number
	hash: string
}
