import { isHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { calculateMemberPermissions, PERMISSIONS } from '../../../../../../../scripts/p2p/permissions.mjs'

import { createEmptySessionState } from './reducers/helpers.mjs'
import { CHAT_EVENT_REDUCERS } from './reducers/index.mjs'

/** @typedef {import('../../../../../../../decl/p2pAPI.ts').RuntimeGroupState} RuntimeGroupState */
/** @typedef {import('../../../../../../../decl/p2pAPI.ts').Checkpoint} Checkpoint */

/**
 * 重导出聊天 reducer 表与空会话状态工厂。
 */
export { CHAT_EVENT_REDUCERS, createEmptySessionState }

/**
 * 将 overlay 选民键规范为小写十六进制字符串。
 * @param {unknown} value checkpoint overlay 选民键
 * @returns {string} 规范化后的 hex 键
 */
function normHex(value) {
	return String(value ?? '').trim().toLowerCase()
}

/** §7.2 默认群设置（`defaultChannelId` 由建群时单独填入）。 */
export const DEFAULT_GROUP_SETTINGS = {
	joinPolicy: 'invite-only',
	powDifficulty: 4,
	fileSizeLimit: 10 * 1024 * 1024,
	fileQuotaBytes: 2 * 1024 * 1024 * 1024,
	fileUploadPolicy: 'all_members',
	fileReplicationFactor: 2,
	lateMessageFreezeMs: 30_000,
	streamGeneratingIdleMs: 150_000,
	hlcMaxSkewMs: 3_600_000,
	streamingSfuWss: null,
	maxDagPayloadBytes: 262_144,
	maxPeers: 24,
	trustedPeerSlots: 8,
	explorePeerSlots: 4,
	gossipTtl: 2,
	wantIdsBudget: 16,
	/** 静态信令频道分区数（含 sync 逻辑分区，至少 2） */
	federationPartitionCount: 8,
	rtcConnectionBudgetMax: 32,
	rtcJoinRatePerMin: 12,
	slashAlertTtl: 86_400_000,
	batterySaver: false,
	autoReplyFrequency: 0,
	eventRetentionDepth: 200_000,
	eventRetentionMs: 365 * 24 * 3600 * 1000,
	/** 0 = 不自动删除消息正文；>0 时按毫秒裁 `messages/*.jsonl` */
	messageContentRetentionMs: 0,
	compactTriggerEventDepth: 100_000,
	/** 热区：每频道保留时间最新的 N 帖 eventId */
	hotLatestMessageCount: 50,
	/** 每个 pin 保留 ±N 邻帖（按频道时间序） */
	pinContextMessageCount: 30,
	/** 仅当帖已冷归档后才允许从 DAG 删除 message */
	dagFoldAfterArchive: true,
	/** 关闭自动按时间裁 messages.jsonl */
	autoPruneMessagesJsonl: false,
	/** 关闭 retention 删除未归档 message */
	autoPruneDagMessages: false,
	messageRateLimitPerMin: 10,
	messageRateLimitWindowMs: 60_000,
	iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
	/** 是否在联邦发现 gossip 中公开此群（不含 roomSecret） */
	discoveryPublic: false,
	discoveryTitle: null,
	discoveryBlurb: null,
}

/**
 * @param {unknown} rawMo checkpoint `messageOverlay`
 * @returns {[string, Map<string, string>][]} ballotId → 选民 Map 条目
 */
function votesEntriesFromOverlay(rawMo) {
	return Object.entries(rawMo.votes)
		.filter(([ballotId]) => !!ballotId)
		.map(([ballotId, voters]) => [ballotId, new Map(Object.entries(voters))])
}

/**
 * @param {Map<string, Map<string, string>>} votesMap 物化 overlay.votes
 * @returns {Record<string, Record<string, string>>} JSON 可序列化形状
 */
export function serializeVotesOverlay(votesMap) {
	const out = {}
	for (const [ballotId, voters] of votesMap)
		out[ballotId] = Object.fromEntries(voters)
	return out
}

/**
 * @param {Map<string, Set<string>>} reactionsMap 物化 overlay.reactions
 * @returns {Record<string, string[]>} JSON 可序列化形状
 */
export function serializeReactionsOverlay(reactionsMap) {
	const out = {}
	for (const [key, voters] of reactionsMap)
		out[key] = [...voters]
	return out
}

/**
 * @param {unknown} rawMo checkpoint `messageOverlay`
 * @returns {[string, Set<string>][]} `"targetId:emoji" → 选民 Set` 条目
 */
function reactionsEntriesFromOverlay(rawMo) {
	return Object.entries(rawMo.reactions)
		.filter(([key]) => !!key)
		.map(([key, voters]) => [key, new Set(voters.map(voter => normHex(voter)))])
}

/**
 * @returns {object} 空消息 overlay（Set/Map）
 */
function emptyMessageOverlay() {
	return {
		deletedIds: new Set(),
		editHistory: new Map(),
		feedbackHistory: new Map(),
		reactions: new Map(),
		pins: new Map(),
		fileIndex: new Map(),
		/** ballotEventId -> Map<voterKey, choice> */
		votes: new Map(),
	}
}

/**
 * 应用单条 DAG 事件到状态（就地修改 state，返回同一引用）。
 * @param {object} state 当前状态
 * @param {object} event DAG 事件（已 canonicalize 落盘）
 * @returns {object} 应用单条事件后的 state（与入参同一对象）
 */
export function applyEvent(state, event) {
	const reducer = CHAT_EVENT_REDUCERS[event.type]
	if (!reducer)
		throw new Error(`unknown chat DAG event type: ${event.type}`)
	return reducer(state, event)
}

/**
 * 空物化状态（尚无 checkpoint、尚未重放事件时）。
 * @returns {object} 可传入 `applyEvent` 的初始状态
 */
export function emptyMaterializedState() {
	return {
		groupId: '',
		members: {},
		membersRoot: null,
		membersPagesCount: 1,
		roles: {},
		channelPermissions: {},
		channelKeyGeneration: {},
		channelKeyWraps: {},
		channels: {},
		fileFolders: {},
		groupMeta: { name: '', description: '', avatar: null },
		groupSettings: { ...DEFAULT_GROUP_SETTINGS, defaultChannelId: null },
		reputationLedger: [],
		inviteEdges: [],
		fileMasterKeyRotations: [],
		pexHints: [],
		messageOverlay: emptyMessageOverlay(),
		messageSenderIndex: {},
		checkpoint_event_id: null,
		epoch_id: 0,
		epoch_root_hash: null,
		bannedMembers: new Set(),
		bannedEntities: new Set(),
		bannedNodes: new Set(),
		delegatedOwnerPubKeyHash: null,
		ownerHeartbeats: {},
		session: createEmptySessionState(),
	}
}

/**
 * 从磁盘 checkpoint 还原运行时物化状态（Set/Map 等）。
 * @param {object} checkpoint `checkpoint.json` 解析对象
 * @returns {object} 与 `applyEvent` 输出同形的物化状态
 */
export function materializeFromCheckpoint(checkpoint) {
	const membersRecord = checkpoint.members_record
	const rawMo = membersRecord.messageOverlay

	return {
		groupId: membersRecord.groupId,
		members: structuredClone(membersRecord.members),
		membersRoot: membersRecord.membersRoot,
		membersPagesCount: membersRecord.membersPagesCount,
		roles: structuredClone(membersRecord.roles),
		channelPermissions: structuredClone(membersRecord.channelPermissions),
		channelKeyGeneration: structuredClone(membersRecord.channelKeyGeneration || {}),
		channelKeyWraps: structuredClone(membersRecord.channelKeyWraps || {}),
		channels: structuredClone(membersRecord.channels),
		fileFolders: structuredClone(membersRecord.fileFolders),
		groupMeta: structuredClone(membersRecord.groupMeta),
		groupSettings: structuredClone(membersRecord.groupSettings),
		messageOverlay: {
			deletedIds: new Set(rawMo.deletedIds),
			editHistory: new Map(Object.entries(rawMo.editHistory)),
			feedbackHistory: new Map(Object.entries(rawMo.feedbackHistory || {})),
			reactions: new Map(reactionsEntriesFromOverlay(rawMo)),
			pins: new Map(Object.entries(rawMo.pins)),
			fileIndex: new Map(Object.entries(rawMo.fileIndex)),
			votes: new Map(votesEntriesFromOverlay(rawMo)),
		},
		pexHints: [...membersRecord.pexHints],
		checkpoint_event_id: checkpoint.checkpoint_event_id,
		epoch_id: checkpoint.epoch_id,
		epoch_root_hash: checkpoint.epoch_root_hash,
		bannedMembers: new Set(membersRecord.bannedMembers),
		bannedEntities: new Set(membersRecord.bannedEntities),
		bannedNodes: new Set(membersRecord.bannedNodes),
		delegatedOwnerPubKeyHash: membersRecord.delegatedOwnerPubKeyHash,
		ownerHeartbeats: structuredClone(membersRecord.ownerHeartbeats),
		reputationLedger: structuredClone(membersRecord.reputationLedger),
		inviteEdges: structuredClone(membersRecord.inviteEdges),
		fileMasterKeyRotations: structuredClone(membersRecord.fileMasterKeyRotations || []),
		messageSenderIndex: structuredClone(membersRecord.messageSenderIndex || {}),
		session: structuredClone(membersRecord.session),
	}
}

/**
 * 当前物化状态下具备 `ADMIN` 的成员公钥指纹集合。
 * @param {object} state 物化状态
 * @returns {Set<string>} 管理员 pubKeyHash
 */
export function adminPubKeyHashes(state) {
	const out = new Set()
	for (const [key, member] of Object.entries(state.members)) {
		if (member?.status !== 'active') continue
		const hash = key
		for (const roleId of member.roles || [])
			if (state.roles[roleId]?.permissions?.ADMIN) {
				out.add(hash)
				break
			}
	}
	return out
}

/**
 * 具备 `MANAGE_ADMINS` 的活跃成员公钥指纹（群主继任后的 checkpoint 签名人选）。
 * @param {object} state 物化状态
 * @returns {Set<string>} pubKeyHash 集合
 */
export function manageAdminsPubKeyHashes(state) {
	const out = new Set()
	for (const [key, member] of Object.entries(state.members)) {
		if (member?.status !== 'active') continue
		const hash = key
		if (!isHex64(hash)) continue
		for (const roleId of member.roles || [])
			if (state.roles[roleId]?.permissions?.MANAGE_ADMINS) {
				out.add(hash)
				break
			}
	}
	return out
}

/**
 * 可签署 checkpoint 的公钥指纹：显式 `delegatedOwner` → `MANAGE_ADMINS` 持有者 → `ADMIN` 持有者。
 * @param {object} state 物化状态
 * @returns {Set<string>} 允许签名的 pubKeyHash
 */
export function checkpointSignerPubKeyHashes(state) {
	const delegated = String(state.delegatedOwnerPubKeyHash || '').trim().toLowerCase()
	if (isHex64(delegated)) return new Set([delegated])
	const manage = manageAdminsPubKeyHashes(state)
	if (manage.size) return manage
	return adminPubKeyHashes(state)
}

/**
 * 某成员在某频道上的有效权限表（用于发送前 gate）。
 * @param {object} state 物化状态
 * @param {string} senderPubKeyHash 发送方 pubKeyHash（hex）
 * @param {string} channelId 频道 ID
 * @returns {Record<string, boolean>} 权限键 → 是否允许
 */
export function memberChannelPermissions(state, senderPubKeyHash, channelId) {
	const memberKey = String(senderPubKeyHash).toLowerCase()
	if (state.members[memberKey]?.status !== 'active')
		return Object.fromEntries(Object.values(PERMISSIONS).map(permission => [permission, false]))

	return calculateMemberPermissions(
		state.members[memberKey],
		state.roles,
		channelId,
		state.channelPermissions
	)
}
