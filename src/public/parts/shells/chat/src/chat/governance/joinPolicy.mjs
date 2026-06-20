/**
 * 【文件】governance/joinPolicy.mjs
 * 【职责】统一校验 member_join 入群策略：开放、仅邀请码、PoW 质询、创世角色限制等，供本地 append 与联邦入站共用。
 * 【原理】读取物化 state.groupSettings.joinPolicy；invite 模式比对 inviteCode；pow 模式调用无状态 verifyJoinPow（绑定近期 DAG tip）；genesis 模式限制首几笔事件角色。失败则拒绝事件落盘。
 * 【数据结构】join 事件 content 含 inviteCode、powSolution { anchorRef, epoch, nonce, joinerNodeHash? }；state.groupSettings.joinPolicy 字符串枚举。
 * 【关联】scripts/p2p/join_pow.mjs、joinPowAnchors.mjs、inviteTickets.mjs、dag/append、room ingest。
 */
import { JOIN_POW_DEFAULT_EPOCH_MS, powVoluntaryBonus, verifyJoinPow } from '../../../../../../../scripts/p2p/join_pow.mjs'
import { normalizeHex64 as normalizePubKeyHex } from '../../../../../../../scripts/p2p/hexIds.mjs'

import { collectJoinPowAnchors, joinPowExemptAsHistoricalReplay } from './joinPowAnchors.mjs'

/**
 * 从 member_join 推导 PoW 自愿信誉加成（非 pow 群或无 solution 则 0）。
 * @param {object} state 物化群状态
 * @param {{ sender?: string, content?: object }} event DAG 事件
 * @returns {number} 加成
 */
export function joinPowBonusFromMemberJoin(state, event) {
	if (event?.type !== 'member_join') return 0
	if ((state.groupSettings?.joinPolicy || '') !== 'pow') return 0
	const content = event.content || {}
	const powSolution = content.powSolution ?? content.pow
	if (!powSolution) return 0
	const floorBits = Number(state.groupSettings?.powFloorBits)
		|| Number(state.groupSettings?.powDifficulty)
		|| Number(state.groupSettings?.powDifficultyBits)
		|| 0
	if (floorBits <= 0) return 0
	const senderNodeHash = String(event.sender || '').trim().toLowerCase()
	const { ok, achievedBits } = verifyJoinPow(powSolution, {
		groupId: state.groupId,
		senderNodeHash,
		knownAnchors: collectJoinPowAnchors(state),
		now: Date.now(),
		difficultyBits: floorBits,
		epochMs: Number(state.groupSettings?.powEpochMs) || JOIN_POW_DEFAULT_EPOCH_MS,
	})
	if (!ok) return 0
	return powVoluntaryBonus(achievedBits, floorBits)
}

/**
 * 统一校验 member_join 入群策略（本地 append 与联邦入站共用）。
 * @param {object} state 物化群状态
 * @param {{ type?: string, content?: object }} event DAG 事件
 * @param {string} replicaUsername replica 所有者（PoW 校验用）
 * @returns {Promise<void>}
 */
export async function validateJoinPolicy(state, event, replicaUsername) {
	if (event?.type !== 'member_join') return
	const content = event.content || {}
	if (content.memberKind === 'agent') return
	const joinPolicy = state.groupSettings?.joinPolicy || 'invite-only'
	const activeBefore = Object.values(state.members).filter(groupMember => groupMember?.status === 'active').length
	const senderKey = String(event.sender || '').trim().toLowerCase()
	const senderAlreadyActive = state.members?.[senderKey]?.status === 'active'
	if (Array.isArray(content.roles)) {
		// adopted-base catch-up 会经 gossip 拉回已知成员的创世 member_join（带 roles）：
		// 若 sender 在当前 state 中已是 active 成员，则这是历史/重复 join 的幂等重放，
		// 放行而不视为"新成员擅自带 roles 提权"（后者 sender 未 active，仍被拒）。
		const allowExtraRoles = activeBefore === 0 || senderAlreadyActive
		if (!allowExtraRoles)
			throw new Error('member_join roles only allowed for genesis join')
		for (const roleId of content.roles) {
			if (roleId === '@everyone') continue
			if (!state.roles[roleId]) throw new Error(`member_join unknown role: ${roleId}`)
		}
	}
	const hasDmIntroProof = String(content.dmIntroNonce || '').trim().length >= 16
		&& /^[\da-f]{128}$/iu.test(String(content.dmIntroSignatureHex || '').trim().replace(/^0x/iu, ''))
	const dmMeta = state.groupMeta || {}
	const dmKnownPeer = dmMeta.dmKind === 'ecdh' && [dmMeta.dmPeerPubKeyHex, dmMeta.dmMyPubKeyHex, dmMeta.dmPubKeyLow, dmMeta.dmPubKeyHigh]
		.map(v => normalizePubKeyHex(v))
		.filter(Boolean)
		.includes(senderKey)
	if (joinPolicy === 'invite-only' && !content.inviteCode && !hasDmIntroProof && activeBefore > 0
		&& !senderAlreadyActive && !dmKnownPeer)
		throw new Error('member_join requires inviteCode')
	if (joinPolicy === 'pow') {
		if (joinPowExemptAsHistoricalReplay(state, event)) return
		const floorBits = Number(state.groupSettings?.powFloorBits)
			|| Number(state.groupSettings?.powDifficulty)
			|| Number(state.groupSettings?.powDifficultyBits)
			|| 0
		if (floorBits <= 0) throw new Error('pow joinPolicy requires powFloorBits >= 1')
		const senderNodeHash = String(event.sender || '').trim().toLowerCase()
		const powSolution = content.powSolution ?? content.pow
		const { ok } = verifyJoinPow(powSolution, {
			groupId: state.groupId,
			senderNodeHash,
			knownAnchors: collectJoinPowAnchors(state),
			now: Date.now(),
			difficultyBits: floorBits,
			epochMs: Number(state.groupSettings?.powEpochMs) || JOIN_POW_DEFAULT_EPOCH_MS,
		})
		if (!ok)
			throw new Error('invalid or expired pow solution')
	}
}
