import { isEntityHash128 } from './entityHash.mjs'
import {
	entityHashFromRecoveryPubKeyHex,
	entityHashFromSubjectHash,
	hashFromPubKeyHex,
} from './entityId.mjs'
import { isHex64, normalizeHex64 } from './pubKeyHex.mjs'

/**
 * @typedef {object} FriendBinding
 * @property {string} entityHash 128 位对端 entityHash
 * @property {string} [displayName] 展示名
 * @property {string} [charname] 本地角色 part 名
 */

/**
 * @param {unknown} raw 原始绑定
 * @returns {FriendBinding | null} 校验后的绑定；无效输入为 null
 */
export function normalizeFriendBinding(raw) {
	if (!raw) return null
	const entityHash = String(raw.entityHash ?? '').trim().toLowerCase()
	if (!isEntityHash128(entityHash)) return null
	const charname = String(raw.charname ?? '').trim() || undefined
	const displayName = String(raw.displayName ?? '').trim() || undefined
	return { entityHash, ...displayName ? { displayName } : {}, ...charname ? { charname } : {} }
}

/**
 * @param {string} entityHash 后端已解析的 agent entityHash（禁止路径派生）
 * @param {string} charname 角色 part 名
 * @param {string} [displayName] 展示名
 * @returns {FriendBinding} 角色 agent 绑定
 */
export function buildCharFriendBinding(entityHash, charname, displayName) {
	const eh = String(entityHash || '').trim().toLowerCase()
	if (!isEntityHash128(eh)) throw new Error('entityHash required')
	const name = String(charname || '').trim()
	if (!name) throw new Error('charname required')
	return {
		entityHash: eh,
		charname: name,
		...displayName ? { displayName } : {},
	}
}

/**
 * @param {object} peer 对端
 * @returns {Promise<FriendBinding>} 用户 federation 绑定
 */
export async function buildUserFriendBinding(peer) {
	const existing = String(peer?.entityHash ?? '').trim().toLowerCase()
	if (isEntityHash128(existing))
		return {
			entityHash: existing,
			...peer.displayName ? { displayName: String(peer.displayName).trim() } : {},
		}

	const nodeHash = normalizeHex64(peer?.nodeHash || '')
	const recoveryPubKeyHex = normalizeHex64(peer?.recoveryPubKeyHex || '')
	if (isHex64(nodeHash) && isHex64(recoveryPubKeyHex))
		return {
			entityHash: await entityHashFromRecoveryPubKeyHex(nodeHash, recoveryPubKeyHex),
			...peer.displayName ? { displayName: String(peer.displayName).trim() } : {},
		}

	let subjectHash = normalizeHex64(peer?.subjectHash || peer?.pubKeyHash || '')
	if (!isHex64(subjectHash)) {
		const pubKeyHex = normalizeHex64(peer?.pubKeyHex || '')
		if (isHex64(pubKeyHex)) subjectHash = await hashFromPubKeyHex(pubKeyHex)
	}
	if (isHex64(nodeHash) && isHex64(subjectHash))
		return {
			entityHash: entityHashFromSubjectHash(nodeHash, subjectHash),
			...peer.displayName ? { displayName: String(peer.displayName).trim() } : {},
		}

	throw new Error('peer entityHash, or nodeHash with recoveryPubKeyHex/subjectHash required')
}
