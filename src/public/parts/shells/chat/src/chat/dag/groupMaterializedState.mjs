import { calculateMemberPermissions, PERMISSIONS } from 'fount/public/parts/shells/chat/src/permissions/chat.mjs'
import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'

import { CHAT_EVENT_REDUCERS } from './reducers/index.mjs'
import { createEmptySessionState } from './reducers/state.mjs'
import { materializeGroupSettings } from './groupSettings.mjs'

/** @typedef {import('../../../../../../../decl/p2pAPI.ts').RuntimeGroupState} RuntimeGroupState */
/** @typedef {import('../../../../../../../decl/p2pAPI.ts').Checkpoint} Checkpoint */

/**
 * 将 overlay 选民键规范为小写十六进制字符串。
 * @param {unknown} value checkpoint overlay 选民键
 * @returns {string} 规范化后的 hex 键
 */
function normHex(value) {
	return String(value ?? '').trim().toLowerCase()
}

/**
 * 从 checkpoint overlay 还原 votes Map 条目。
 * @param {unknown} rawMo checkpoint `messageOverlay`
 * @returns {[string, Map<string, string>][]} ballotId → 选民 Map 条目
 */
function votesEntriesFromOverlay(rawMo) {
	return Object.entries(rawMo.votes)
		.filter(([ballotId]) => !!ballotId)
		.map(([ballotId, voters]) => [ballotId, new Map(Object.entries(voters))])
}

/**
 * 将物化 votes Map 序列化为 JSON 形状。
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
 * 将物化 reactions Map 序列化为 JSON 形状。
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
 * 从 checkpoint overlay 还原 reactions Map 条目。
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
		/** 选票事件 ID → Map<投票者键, 选择> */
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
		cabinets: {},
		groupMeta: { name: '', description: '', avatar: null },
		groupSettings: materializeGroupSettings({ defaultChannelId: null }),
		reputationLedger: [],
		inviteEdges: [],
		fileMasterKeyRotations: [],
		pexHints: [],
		messageOverlay: emptyMessageOverlay(),
		messageSenderIndex: {},
		voteBallots: {},
		checkpoint_event_id: null,
		epoch_id: 0,
		epoch_root_hash: null,
		bannedMembers: new Set(),
		bannedEntities: new Set(),
		bannedNodes: new Set(),
		delegatedOwnerPubKeyHash: null,
		ownerHeartbeats: {},
		session: createEmptySessionState(),
		worldStates: {},
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
		cabinets: structuredClone(membersRecord.cabinets || {}),
		groupMeta: structuredClone(membersRecord.groupMeta),
		groupSettings: materializeGroupSettings(structuredClone(membersRecord.groupSettings)),
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
		voteBallots: structuredClone(membersRecord.voteBallots || {}),
		session: structuredClone(membersRecord.session),
		worldStates: structuredClone(membersRecord.worldStates || {}),
	}
}

/**
 * 当前物化状态下具备 `ADMIN` 的成员公钥指纹集合。
 * @param {object} state 物化状态
 * @returns {Set<string>} 管理员 pubKeyHash
 */
export function adminPubKeyHashes(state) {
	const out = new Set()
	for (const [hash, member] of Object.entries(state.members)) {
		if (member?.status !== 'active') continue
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
	for (const [hash, member] of Object.entries(state.members)) {
		if (member?.status !== 'active') continue
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
