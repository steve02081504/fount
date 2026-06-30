import { agentEntityHash, isEntityHash128 } from '../../../../../../../../scripts/p2p/entity_id.mjs'

import {
	applyBanContent,
	clearBanForMember,
	clampRepEdge,
	isHex64,
	isJoinBanned,
	recordFileMasterKeyRotation,
	refreshMembersDigest,
	resolveTargetMemberKey,
	syncSessionCharsFromMembers,
	withGroupId,
} from './helpers.mjs'

/** @type {Record<string, (state: object, event: object) => object>} */
export const memberReducers = {
	/**
	 * 处理 `member_join` 事件：登记新成员（user 或 agent）并可选记录邀请边。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	member_join(state, event) {
		withGroupId(state, event)
		const content = event.content || {}
		if (content.memberKind === 'agent') {
			const agentKey = String(content.agentEntityHash || '').trim().toLowerCase()
			const charname = String(content.charname || '').trim()
			const homeNodeHash = content.homeNodeHash
			const ownerPubKeyHash = event.sender
			if (!isEntityHash128(agentKey) || !charname || !isHex64(homeNodeHash))
				return state
			if (agentEntityHash(homeNodeHash, `chars/${charname}`) !== agentKey)
				return state
			if (isJoinBanned(state, ownerPubKeyHash, content))
				return state
			if (state.bannedEntities.has(agentKey))
				return state
			const extraRoles = []
			if (Array.isArray(content.roles)) 
				for (const roleId of content.roles) 
					if (roleId && roleId !== '@everyone' && state.roles[roleId])
						extraRoles.push(roleId)
				
			
			state.members[agentKey] = {
				memberKind: 'agent',
				charname,
				agentEntityHash: agentKey,
				ownerPubKeyHash,
				ownerUsername: String(content.ownerUsername || '').trim(),
				homeNodeHash,
				roles: ['@everyone', ...extraRoles],
				joinedAt: event.timestamp,
				status: 'active',
				replyFrequency: Number.isFinite(Number(content.replyFrequency))
					? Number(content.replyFrequency)
					: undefined,
			}
		}
		else if (!isJoinBanned(state, event.sender, content)) {
			const existing = state.members[event.sender]
			// 已是活跃成员的重复 member_join（DAG 重放 / 检查点重建时对已折叠基态的再应用）必须幂等：
			// 不得重算 extraRoles（此时 activeBefore 含成员自身，会算成 0 个 extraRole）从而回退 founder 等既有角色。
			const isActiveReapply = existing?.status === 'active'
			const activeBefore = Object.values(state.members).filter(member => member?.status === 'active').length
			const extraRoles = activeBefore === 0 && Array.isArray(content.roles)
				? content.roles.filter(roleId => roleId && roleId !== '@everyone' && state.roles[roleId])
				: []
			const homeNodeHash = content.homeNodeHash
			state.members[event.sender] = {
				memberKind: 'user',
				pubKeyHash: event.sender,
				pubKeyHex: event.senderPubKey || existing?.pubKeyHex || null,
				homeNodeHash: homeNodeHash && isHex64(homeNodeHash) ? homeNodeHash : existing?.homeNodeHash ?? null,
				roles: isActiveReapply && existing.roles?.length ? existing.roles : ['@everyone', ...extraRoles],
				joinedAt: isActiveReapply ? existing.joinedAt ?? event.timestamp : event.timestamp,
				status: 'active',
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
	 * 处理 `member_kick` 事件：将目标成员状态设为 `kicked`；user 踢出记录 GSH 轮换。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	member_kick(state, event) {
		withGroupId(state, event)
		const target = resolveTargetMemberKey(event.content)
		const member = target ? state.members[target] : null
		if (target && member)
			member.status = 'kicked'
		if (target && member?.memberKind !== 'agent')
			recordFileMasterKeyRotation(state, event, 'kick', { targetMemberKey: target })
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
