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
	const displayName = String(raw.displayName ?? '').trim() || undefined
	return { entityHash, ...displayName ? { displayName } : {}, ...charname ? { charname } : {} }
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
