import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import { MEMBERS_PAGE_SIZE } from '../../../../../../../../scripts/p2p/constants.mjs'
import { isEntityHash128 } from '../../../../../../../../scripts/p2p/entity_id.mjs'
import { isHex64 } from '../../../../../../../../scripts/p2p/hexIds.mjs'
import { sanitizeIceServersForSettings } from '../../../../../../../../scripts/p2p/ice_servers.mjs'

const MEMBER_KEY_RE = /^[\da-f]{64}$|^[\da-f]{128}$/u

/**
 * 活跃成员 map 键 Merkle 根（64 hex pubKeyHash 或 128 hex agentEntityHash）。
 * @param {string[]} ids 成员键
 * @returns {string} 64 hex 根
 */
export function memberKeysMerkleRoot(ids) {
	const sorted = [...new Set(ids
		.map(id => String(id || '').trim().toLowerCase())
		.filter(id => MEMBER_KEY_RE.test(id)))]
		.sort()
	if (!sorted.length)
		return createHash('sha256').update('', 'utf8').digest('hex')
	/** @type {Buffer[]} */
	let level = sorted.map(id => createHash('sha256').update(id, 'utf8').digest())
	while (level.length > 1) {
		/** @type {Buffer[]} */
		const next = []
		for (let index = 0; index < level.length; index += 2) {
			const left = level[index]
			const right = index + 1 < level.length ? level[index + 1] : left
			next.push(createHash('sha256').update(Buffer.concat([left, right])).digest())
		}
		level = next
	}
	return Buffer.from(level[0]).toString('hex')
}

/**
 * @param {object} state 物化状态
 * @returns {void}
 */
export function refreshMembersDigest(state) {
	const activeKeys = Object.entries(state.members)
		.filter(([, member]) => member?.status === 'active')
		.map(([memberKey]) => memberKey)
		.sort()
	state.membersRoot = activeKeys.length ? memberKeysMerkleRoot(activeKeys) : null
	state.membersPagesCount = Math.max(1, Math.ceil(activeKeys.length / MEMBERS_PAGE_SIZE))
}

/**
 * @param {unknown} value 事件中的原始数值
 * @returns {number} 限制在 [-1, 1] 的声誉边权
 */
export function clampRepEdge(value) {
	const number = Number(value)
	if (!Number.isFinite(number)) return 1
	return Math.max(-1, Math.min(1, number))
}

/**
 * @param {object} state 物化状态
 * @param {object} event DAG 事件
 * @param {'kick' | 'rotate'} rotationType 文件主密钥轮换原因
 * @param {Record<string, unknown>} [extra] 附加字段
 * @returns {void}
 */
export function recordFileMasterKeyRotation(state, event, rotationType, extra = {}) {
	const generation = event.content.key_generation
	const nonce = event.content.new_key_nonce
	if (!Number.isFinite(generation) || !nonce) return
	if (!state.fileMasterKeyRotations) state.fileMasterKeyRotations = []
	state.fileMasterKeyRotations.push({
		eventId: event.id,
		generation,
		nonce,
		type: rotationType,
		...extra,
	})
}

/**
 * @param {object} state 物化群状态
 * @param {string} sender pubKeyHash
 * @param {object} [joinContent] member_join content
 * @returns {boolean} 是否应拒绝该成员加入
 */
export function isJoinBanned(state, sender, joinContent = {}) {
	if (joinContent.memberKind === 'agent') {
		const agentEntityHash = String(joinContent.agentEntityHash || '').trim().toLowerCase()
		if (isEntityHash128(agentEntityHash) && state.bannedEntities.has(agentEntityHash))
			return true
		return state.bannedMembers.has(sender)
	}
	if (state.bannedMembers.has(sender)) return true
	const home = joinContent.homeNodeHash
	if (!isHex64(home)) return false
	return state.bannedNodes.has(home) || state.bannedEntities.has(`${home}${sender}`)
}

/**
 * @param {object} [content] 事件 content
 * @returns {string | null} 目标成员键（64 或 128 hex）
 */
export function resolveTargetMemberKey(content = {}) {
	const key = String(content.targetMemberKey || content.targetPubKeyHash || '').trim().toLowerCase()
	return MEMBER_KEY_RE.test(key) ? key : null
}

/**
 * 从 active agent 成员行同步 `state.session.chars` / `charFrequencies` 派生视图。
 * @param {object} state 物化群状态
 * @returns {void}
 */
export function syncSessionCharsFromMembers(state) {
	if (!state.session) state.session = createEmptySessionState()
	state.session.chars = {}
	state.session.charFrequencies = {}
	for (const member of Object.values(state.members)) {
		if (member?.memberKind !== 'agent' || member.status !== 'active') continue
		const charname = String(member.charname || '').trim()
		if (!charname) continue
		state.session.chars[charname] = {
			ownerUsername: String(member.ownerUsername || '').trim(),
			homeNodeHash: member.homeNodeHash || '',
		}
		if (Number.isFinite(member.replyFrequency))
			state.session.charFrequencies[charname] = member.replyFrequency
	}
}

/**
 * @param {object} state 物化群状态
 * @param {object} content member_ban content
 * @returns {void}
 */
export function applyBanContent(state, content) {
	const targetMemberKey = resolveTargetMemberKey(content)
	const member = targetMemberKey ? state.members[targetMemberKey] : null
	if (member?.memberKind === 'agent') {
		const agentEntityHash = String(member.agentEntityHash || targetMemberKey).toLowerCase()
		if (isEntityHash128(agentEntityHash)) state.bannedEntities.add(agentEntityHash)
	}
	else if (targetMemberKey)
		state.bannedMembers.add(targetMemberKey)
	const entityHash = String(content.targetEntityHash || '').trim().toLowerCase()
	if (isEntityHash128(entityHash)) state.bannedEntities.add(entityHash)
	if (isHex64(content.targetNodeHash)) state.bannedNodes.add(content.targetNodeHash)
}

/**
 * @param {object} state 物化群状态
 * @param {string} targetMemberKey 成员键（64 或 128 hex）
 * @returns {void}
 */
export function clearBanForMember(state, targetMemberKey) {
	const key = String(targetMemberKey || '').trim().toLowerCase()
	const member = state.members[key]
	if (member?.memberKind === 'agent') {
		const agentEntityHash = String(member.agentEntityHash || key).toLowerCase()
		if (isEntityHash128(agentEntityHash)) state.bannedEntities.delete(agentEntityHash)
		const home = member.homeNodeHash
		if (isHex64(home)) state.bannedNodes.delete(home)
		return
	}
	state.bannedMembers.delete(key)
	const home = member?.homeNodeHash
	if (isHex64(home)) {
		state.bannedNodes.delete(home)
		state.bannedEntities.delete(`${home}${key}`)
	}
}

/**
 * @param {object} state 物化状态
 * @param {object} event DAG 事件
 * @returns {object} 更新 groupId 后的 state
 */
export function withGroupId(state, event) {
	if (event?.groupId) state.groupId = event.groupId
	return state
}

/**
 * 空 AI 会话配置（由 session_* DAG 事件物化）。
 * @returns {object} 初始 session 物化字段
 */
export function createEmptySessionState() {
	return {
		chars: {},
		world: null,
		channelWorlds: {},
		personas: {},
		plugins: {},
		charFrequencies: {},
	}
}

/**
 * P2P chat reducer 通用工具（自 `ice_servers`、`hexIds` 再导出）。
 */
export { sanitizeIceServersForSettings, isHex64 }
