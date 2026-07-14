import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import { MEMBERS_PAGE_SIZE } from 'npm:@steve02081504/fount-p2p/core/constants'
import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isHex64, normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'

import { withGroupId } from './state.mjs'
import { clampRepEdge } from './governance.mjs'
import { recordFileMasterKeyRotation } from './files.mjs'
import { createEmptySessionState } from './state.mjs'

const MEMBER_KEY_RE = /^[\da-f]{64}$/u

/**
 * 活跃成员 map 键 Merkle 根（64 hex pubKeyHash）。
 * @param {string[]} ids 成员键
 * @returns {string} 64 hex 根
 */
function memberKeysMerkleRoot(ids) {
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
function refreshMembersDigest(state) {
	const activeKeys = Object.entries(state.members)
		.filter(([, member]) => member?.status === 'active')
		.map(([memberKey]) => memberKey)
		.sort()
	state.membersRoot = activeKeys.length ? memberKeysMerkleRoot(activeKeys) : null
	state.membersPagesCount = Math.max(1, Math.ceil(activeKeys.length / MEMBERS_PAGE_SIZE))
}

/**
 * @param {object} state 物化群状态
 * @param {string} sender pubKeyHash
 * @param {object} [joinContent] member_join content
 * @returns {boolean} 是否应拒绝该成员加入
 */
function isJoinBanned(state, sender, joinContent = {}) {
	const entityHash = String(joinContent.entityHash || '').trim().toLowerCase()
	if (isEntityHash128(entityHash) && state.bannedEntities.has(entityHash))
		return true
	if (state.bannedMembers.has(sender)) return true
	const home = joinContent.homeNodeHash
	if (!isHex64(home)) return false
	return state.bannedNodes.has(home) || state.bannedEntities.has(`${home}${sender}`)
}

/**
 * @param {object} [content] 事件 content
 * @returns {string | null} 目标成员键（64 hex）
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
function syncSessionCharsFromMembers(state) {
	if (!state.session) state.session = createEmptySessionState()
	state.session.chars = {}
	state.session.charFrequencies = {}
	for (const member of Object.values(state.members)) {
		const isAgent = member?.memberKind === 'agent' || Boolean(member?.ownerEntityHash)
		if (!isAgent || member.status !== 'active') continue
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
	if (targetMemberKey)
		state.bannedMembers.add(targetMemberKey)
	const entityHash = String(content.targetEntityHash || member?.entityHash || '').trim().toLowerCase()
	if (isEntityHash128(entityHash)) state.bannedEntities.add(entityHash)
	if (isHex64(content.targetNodeHash)) state.bannedNodes.add(content.targetNodeHash)
	const homeNode = normalizeHex64(member?.homeNodeHash)
	if (isHex64(homeNode)) state.bannedNodes.add(homeNode)
}

/**
 * @param {object} state 物化群状态
 * @param {string} targetMemberKey 成员键（64 hex）
 * @returns {void}
 */
export function clearBanForMember(state, targetMemberKey) {
	const key = String(targetMemberKey || '').trim().toLowerCase()
	const member = state.members[key]
	state.bannedMembers.delete(key)
	const entityHash = String(member?.entityHash || '').trim().toLowerCase()
	if (isEntityHash128(entityHash)) state.bannedEntities.delete(entityHash)
	const home = member?.homeNodeHash
	if (isHex64(home)) {
		state.bannedNodes.delete(home)
		state.bannedEntities.delete(`${home}${key}`)
	}
}

/** @type {Record<string, (state: object, event: object) => object>} */
export const memberReducers = {
	/**
	 * 处理 `member_join`：按 event.sender（64-hex pubKeyHash）登记成员行，含实体声明。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	member_join(state, event) {
		withGroupId(state, event)
		const content = event.content || {}
		if (isJoinBanned(state, event.sender, content))
			return state

		const entityHash = String(content.entityHash || '').trim().toLowerCase()
		if (!isEntityHash128(entityHash))
			return state

		const ownerEntityHash = String(content.ownerEntityHash || '').trim().toLowerCase() || null
		const memberKind = ownerEntityHash && isEntityHash128(ownerEntityHash) ? 'agent' : 'user'
		const existing = state.members[event.sender]
		// 已是活跃成员的重复 member_join（DAG 重放 / 检查点重建时对已折叠基态的再应用）必须幂等：
		// 不得重算 extraRoles（此时 activeBefore 含成员自身，会算成 0 个 extraRole）从而回退 founder 等既有角色。
		const isActiveReapply = existing?.status === 'active'
		const activeBefore = Object.values(state.members).filter(member => member?.status === 'active').length
		const allowDeclaredRoles = !isActiveReapply && (memberKind === 'agent' || activeBefore === 0)
		const extraRoles = allowDeclaredRoles && Array.isArray(content.roles)
			? content.roles.filter(roleId => roleId && roleId !== '@everyone' && state.roles[roleId])
			: []
		const homeNodeHash = content.homeNodeHash

		state.members[event.sender] = {
			memberKind,
			entityHash,
			ownerEntityHash: memberKind === 'agent' ? ownerEntityHash : null,
			pubKeyHash: event.sender,
			pubKeyHex: event.senderPubKey || existing?.pubKeyHex || null,
			homeNodeHash: homeNodeHash && isHex64(homeNodeHash) ? homeNodeHash : existing?.homeNodeHash ?? null,
			roles: isActiveReapply && existing.roles?.length ? existing.roles : ['@everyone', ...extraRoles],
			joinedAt: isActiveReapply ? existing.joinedAt ?? event.timestamp : event.timestamp,
			status: 'active',
			charname: memberKind === 'agent'
				? String(content.charname || existing?.charname || '').trim() || undefined
				: undefined,
			ownerUsername: memberKind === 'agent'
				? String(content.ownerUsername || existing?.ownerUsername || '').trim() || undefined
				: undefined,
			replyFrequency: memberKind === 'agent' && Number.isFinite(Number(content.replyFrequency))
				? Number(content.replyFrequency)
				: existing?.replyFrequency,
			repEdgeFromIntroducer: isActiveReapply ? existing.repEdgeFromIntroducer : clampRepEdge(content.reputationEdge),
		}

		const introducer = content.introducerPubKeyHash
		const joiner = event.sender
		if (introducer && isHex64(introducer) && isHex64(joiner) && introducer !== joiner
			&& !state.inviteEdges.some(edge => edge.from === introducer && edge.to === joiner)) {
			const edge = { from: introducer, to: joiner, at: event.timestamp }
			if (content.reputationEdge !== undefined)
				edge.reputationEdge = clampRepEdge(content.reputationEdge)
			state.inviteEdges.push(edge)
		}

		syncSessionCharsFromMembers(state)
		refreshMembersDigest(state)
		return state
	},

	/**
	 * 处理 `member_leave` 事件：将发送方成员状态设为 `left`。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	member_leave(state, event) {
		withGroupId(state, event)
		if (state.members[event.sender])
			state.members[event.sender].status = 'left'
		syncSessionCharsFromMembers(state)
		refreshMembersDigest(state)
		return state
	},

	/**
	 * 处理 `member_kick` 事件：将目标成员状态设为 `kicked`；记录 GSH 轮换。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	member_kick(state, event) {
		withGroupId(state, event)
		const target = resolveTargetMemberKey(event.content)
		const member = target ? state.members[target] : null
		if (target && member) {
			member.status = 'kicked'
			recordFileMasterKeyRotation(state, event, 'kick', { targetMemberKey: target })
		}
		syncSessionCharsFromMembers(state)
		refreshMembersDigest(state)
		return state
	},

	/**
	 * 处理 `member_ban` 事件：写入封禁集合并将目标成员状态设为 `banned`。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	member_ban(state, event) {
		withGroupId(state, event)
		applyBanContent(state, event.content)
		const target = resolveTargetMemberKey(event.content)
		if (target && state.members[target])
			state.members[target].status = 'banned'
		syncSessionCharsFromMembers(state)
		refreshMembersDigest(state)
		return state
	},

	/**
	 * 处理 `member_unban` 事件：清除目标封禁记录并恢复成员为 `active`。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	member_unban(state, event) {
		withGroupId(state, event)
		const target = resolveTargetMemberKey(event.content)
		clearBanForMember(state, target)
		if (target && state.members[target])
			state.members[target].status = 'active'
		syncSessionCharsFromMembers(state)
		refreshMembersDigest(state)
		return state
	},

	/**
	 * 处理 `agent_reply_frequency_set`：更新 agent 成员发言频率并同步 session 派生视图。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	agent_reply_frequency_set(state, event) {
		withGroupId(state, event)
		const target = resolveTargetMemberKey(event.content)
		const frequency = Number(event.content?.frequency)
		const member = target ? state.members[target] : null
		if (member?.memberKind === 'agent' && Number.isFinite(frequency))
			member.replyFrequency = frequency
		syncSessionCharsFromMembers(state)
		return state
	},
}
