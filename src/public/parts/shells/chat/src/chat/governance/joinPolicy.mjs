/**
 * 【文件】governance/joinPolicy.mjs
 * 【职责】统一校验 member_join 入群策略：开放、仅邀请码、PoW 质询、创世角色限制等，供本地 append 与联邦入站共用。
 * 【原理】读取物化 state.groupSettings.joinPolicy；invite 模式比对 inviteCode；pow 模式调用无状态 verifyJoinPow（绑定近期 DAG tip）；genesis 模式限制首几笔事件角色。失败则拒绝事件落盘。
 * 【数据结构】join 事件 content 含 inviteCode、powSolution { anchorRef, epoch, nonce, joinerNodeHash? }；state.groupSettings.joinPolicy 字符串枚举。
 * 【关联】scripts/p2p/join_pow.mjs、joinPowAnchors.mjs、inviteTickets.mjs、dag/append、room ingest。
 */
import { normalizeHex64 as normalizePubKeyHex } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { JOIN_POW_DEFAULT_EPOCH_MS, powVoluntaryBonus, verifyJoinPow } from '../../../../../../../scripts/p2p/join_pow.mjs'
import { verifyGroupInviteTicket } from '../lib/inviteTickets.mjs'

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
 * 构造 join 策略校验错误；可标记 `pendable` 让联邦入站走 pending_ingest 重放而非永久 drop。
 * @param {string} message 错误消息
 * @param {{ pendable?: boolean }} [meta] 错误元数据
 * @returns {Error & { pendable?: boolean }} 错误实例
 */
function joinPolicyError(message, { pendable = false } = {}) {
	const error = new Error(message)
	if (pendable) error.pendable = true
	return error
}

/**
 * 统一校验 member_join 入群策略（本地 append 与联邦入站共用）。
 *
 * 联邦入站（`opts.source === 'federation'`）针对**角色相关**的拒绝抛 `pendable` 错误：
 *   - "roles only allowed for genesis join"：sender 在本节点尚未 active，但其 join 经 gossip 先于祖先链抵达，
 *     待 catchup 把 sender 标 active 后重放即可；
 *   - "unknown role"：role_create 事件可能晚于 member_join 抵达，待重放即可。
 * 本地 append 路径继续硬拒（防止本地擅自带 roles 提权）。
 *
 * 邀请/PoW 等"签名时即固定"的不变量在两条路径上均硬拒。
 *
 * @param {object} state 物化群状态
 * @param {{ type?: string, content?: object }} event DAG 事件
 * @param {string} replicaUsername replica 所有者（PoW 校验用）
 * @param {{ source?: 'local' | 'federation' }} [opts] 入站来源
 * @returns {Promise<void>}
 */
export async function validateJoinPolicy(state, event, replicaUsername, opts = {}) {
	if (event?.type !== 'member_join') return
	const content = event.content || {}
	if (content.memberKind === 'agent') return
	const fromFederation = opts.source === 'federation'
	const joinPolicy = state.groupSettings?.joinPolicy || 'invite-only'
	const activeBefore = Object.values(state.members).filter(groupMember => groupMember?.status === 'active').length
	const senderKey = String(event.sender || '').trim().toLowerCase()
	const senderAlreadyActive = state.members?.[senderKey]?.status === 'active'
	if (Array.isArray(content.roles)) {
		const allowExtraRoles = activeBefore === 0 || senderAlreadyActive
		if (!allowExtraRoles)
			throw joinPolicyError('member_join roles only allowed for genesis join', { pendable: fromFederation })
		for (const roleId of content.roles) {
			if (roleId === '@everyone') continue
			if (!state.roles[roleId])
				throw joinPolicyError(`member_join unknown role: ${roleId}`, { pendable: fromFederation })
		}
	}
	const hasDmIntroProof = String(content.dmIntroNonce || '').trim().length >= 16
		&& /^[\da-f]{128}$/iu.test(String(content.dmIntroSignatureHex || '').trim().replace(/^0x/iu, ''))
	const dmMeta = state.groupMeta || {}
	const dmKnownPeer = dmMeta.dmKind === 'ecdh' && [dmMeta.dmPeerPubKeyHex, dmMeta.dmMyPubKeyHex, dmMeta.dmPubKeyLow, dmMeta.dmPubKeyHigh]
		.map(v => normalizePubKeyHex(v))
		.filter(Boolean)
		.includes(senderKey)
	if (joinPolicy === 'invite-only' && !hasDmIntroProof && activeBefore > 0 && !senderAlreadyActive && !dmKnownPeer) {
		if (!content.inviteCode)
			throw new Error('member_join requires inviteCode')
		// 仅签发者（持本群 invite_hmac.key 的节点，通常即 owner）能校验邀请；
		// 其他节点拿不到密钥，verify 返回 'unverifiable' 即放行，避免可构陷的误拒。
		if (await verifyGroupInviteTicket(replicaUsername, state.groupId, content.inviteCode) === 'invalid')
			throw new Error('member_join invite code invalid or expired')
	}
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
