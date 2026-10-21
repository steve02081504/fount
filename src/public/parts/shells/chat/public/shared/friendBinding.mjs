import { isHex64 } from 'https://esm.sh/@steve02081504/fount-p2p/core/hexIds'

import { isEntityHash128 } from './entityHash.mjs'
import {
	entityHashFromRecoveryPubKeyHex,
	entityHashFromSubjectHash,
	hashFromPubKeyHex,
} from './entityId.mjs'

/**
 * 好友私聊绑定：对端 entityHash 与可选展示字段。
 * @typedef {object} FriendBinding
 * @property {string} entityHash 128 位对端 entityHash
 * @property {string} [displayName] 展示名
 * @property {string} [charname] 本地角色 part 名
 */

/**
 * 判断候选绑定是否匹配请求（按 entityHash 或 charname）。
 * @param {{ entityHash?: string, charname?: string } | null | undefined} candidate 候选绑定
 * @param {{ entityHash?: string, charname?: string } | null | undefined} requested 请求绑定
 * @returns {boolean} 是否匹配
 */
export function friendBindingMatches(candidate, requested) {
	if (!candidate || !requested) return false
	if (requested.entityHash && candidate.entityHash === requested.entityHash) return true
	return !!(requested.charname && candidate.charname === requested.charname)
}

/**
 * 规范化并校验好友绑定对象。
 * @param {unknown} raw 原始绑定
 * @returns {FriendBinding | null} 校验后的绑定；无效输入为 null
 */
export function normalizeFriendBinding(raw) {
	if (!raw) return null
	const entityHash = raw.entityHash ?? ''
	if (!isEntityHash128(entityHash)) return null
	const charname = raw.charname || undefined
	const displayName = (raw.displayName ?? '') || undefined
	return { entityHash, ...displayName ? { displayName } : {}, ...charname ? { charname } : {} }
}

/**
 * 按查看者解析 DM 群的好友绑定。
 *
 * 群元数据里的 `friendBinding` 只记录**建群者视角**的对端，却随 groupMeta 一起联邦给受邀方；
 * 受邀方物化同一份元数据后，它指向的就变成了受邀方自己（好友列表里是一行指向自己的空会话）。
 * 故 ECDH DM 一律按本群活跃成员把对端还原成查看者视角；成员还没汇合时回退到元数据原值。
 * @param {{ groupMeta?: { dmKind?: string, friendBinding?: unknown }, members?: Record<string, { status?: string, memberKind?: string, entityHash?: string }> }} state 物化群状态
 * @param {string | null | undefined} localMemberKey 查看者的本群成员键（pubKeyHash）
 * @returns {FriendBinding | null} 查看者视角的好友绑定
 */
export function resolveViewerFriendBinding(state, localMemberKey) {
	const stored = normalizeFriendBinding(state?.groupMeta?.friendBinding)
	// DM 以外的群没有「对端」语义，char DM 的 charname 绑定也只对本机成立，都原样返回。
	if (state?.groupMeta?.dmKind !== 'ecdh' || !localMemberKey) return stored
	const peers = Object.entries(state.members || {})
		.filter(([memberKey, member]) => memberKey !== localMemberKey
			&& member?.status === 'active'
			&& member?.memberKind !== 'agent')
	if (peers.length !== 1) return stored
	const peer = normalizeFriendBinding({ entityHash: peers[0][1].entityHash })
	if (!peer) return stored
	// 建群者视角本就指向对端：保留原值（含 displayName 等展示字段）。
	return stored?.entityHash === peer.entityHash ? stored : peer
}

/**
 * 构造基于 charname 的建群好友绑定输入（与 entityHash 互斥）。
 * @param {string} charname 角色 part 名
 * @param {string} [displayName] 展示名
 * @returns {{ charname: string, displayName?: string }} 建群输入：仅 charname（与 entityHash 互斥）
 */
export function charFriendBindingInput(charname, displayName) {
	if (!charname) throw new Error('charname required')
	return {
		charname,
		...displayName ? { displayName: displayName.trim() } : {},
	}
}

/**
 * 构造基于 entityHash 的建群好友绑定输入（与 charname 互斥）。
 * @param {string} entityHash 128 位 entityHash
 * @param {string} [displayName] 展示名
 * @returns {{ entityHash: string, displayName?: string }} 建群输入：仅 entityHash（与 charname 互斥）
 */
export function entityFriendBindingInput(entityHash, displayName) {
	if (!isEntityHash128(entityHash)) throw new Error('entityHash required')
	return {
		entityHash,
		...displayName ? { displayName: displayName.trim() } : {},
	}
}

/**
 * @param {object} peer 对端
 * @returns {Promise<FriendBinding>} 用户 federation 绑定
 */
export async function buildUserFriendBinding(peer) {
	const existing = peer?.entityHash ?? ''
	if (isEntityHash128(existing))
		return {
			entityHash: existing,
			...peer.displayName ? { displayName: String(peer.displayName).trim() } : {},
		}

	const nodeHash = peer?.nodeHash || ''
	const recoveryPubKeyHex = peer?.recoveryPubKeyHex || ''
	if (isHex64(nodeHash) && isHex64(recoveryPubKeyHex))
		return {
			entityHash: await entityHashFromRecoveryPubKeyHex(nodeHash, recoveryPubKeyHex),
			...peer.displayName ? { displayName: String(peer.displayName).trim() } : {},
		}

	let subjectHash = peer?.subjectHash || peer?.pubKeyHash || ''
	if (!isHex64(subjectHash)) {
		const pubKeyHex = peer?.pubKeyHex || ''
		if (isHex64(pubKeyHex)) subjectHash = await hashFromPubKeyHex(pubKeyHex)
	}
	if (isHex64(nodeHash) && isHex64(subjectHash))
		return {
			entityHash: entityHashFromSubjectHash(nodeHash, subjectHash),
			...peer.displayName ? { displayName: String(peer.displayName).trim() } : {},
		}

	throw new Error('peer entityHash, or nodeHash with recoveryPubKeyHex/subjectHash required')
}
