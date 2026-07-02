/**
 * 【文件】public/src/friendBinding.mjs
 * 【职责】好友绑定模型：规范化 entityHash、构建角色/用户 FriendBinding。
 * 【原理】agentEntityHash / recovery 或 subjectHash 锚定派生 128 位 hash；normalizeFriendBinding 校验字段。
 * 【数据结构】FriendBinding { entityHash, displayName?, charname? }。
 * 【关联】api/groupFriendBinding.mjs、entityId.mjs；Hub 好友私聊频道。
 */
import { isEntityHash128 } from './lib/entityHash.mjs'
import {
	agentEntityHash,
	hashFromPubKeyHex,
	userEntityHashFromRecoveryPubKeyHex,
	userEntityHashFromSubjectHash,
} from './lib/entityId.mjs'
import { isHex64, normalizeHex64 } from './lib/pubKeyHex.mjs'

/**
 * @typedef {object} FriendBinding
 * @property {string} entityHash 128 位对端 entityHash（角色 agent / 用户 federation 统一）
 * @property {string} [displayName] 展示名
 * @property {string} [charname] 本地角色 part 名；有值表示角色私聊
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
 * @param {string} nodeHash 本机 nodeHash（64 hex）
 * @param {string} charname 角色 part 名
 * @param {string} [displayName] 展示名
 * @returns {Promise<FriendBinding>} 角色 agent 绑定（含 `charname`）
 */
export async function buildCharFriendBinding(nodeHash, charname, displayName) {
	const name = String(charname || '').trim()
	if (!name) throw new Error('charname required')
	return {
		entityHash: await agentEntityHash(nodeHash, `chars/${name}`),
		charname: name,
		...displayName ? { displayName } : {},
	}
}

/**
 * @param {object} peer 对端
 * @param {string} [peer.entityHash] 已有 128 位 entityHash
 * @param {string} [peer.nodeHash] 对端 nodeHash（64 hex）
 * @param {string} [peer.recoveryPubKeyHex] recovery 公钥 hex
 * @param {string} [peer.subjectHash] 成员 pubKeyHash（64 hex）
 * @param {string} [peer.pubKeyHash] 同 subjectHash
 * @param {string} [peer.pubKeyHex] 活跃公钥 hex（与 nodeHash 组合时派生 subjectHash）
 * @param {string} [peer.displayName] 展示名
 * @returns {Promise<FriendBinding>} 用户 federation 绑定（无 `charname`）
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
			entityHash: await userEntityHashFromRecoveryPubKeyHex(nodeHash, recoveryPubKeyHex),
			...peer.displayName ? { displayName: String(peer.displayName).trim() } : {},
		}

	let subjectHash = normalizeHex64(peer?.subjectHash || peer?.pubKeyHash || '')
	if (!isHex64(subjectHash)) {
		const pubKeyHex = normalizeHex64(peer?.pubKeyHex || '')
		if (isHex64(pubKeyHex)) subjectHash = await hashFromPubKeyHex(pubKeyHex)
	}
	if (isHex64(nodeHash) && isHex64(subjectHash))
		return {
			entityHash: userEntityHashFromSubjectHash(nodeHash, subjectHash),
			...peer.displayName ? { displayName: String(peer.displayName).trim() } : {},
		}

	throw new Error('peer entityHash, or nodeHash with recoveryPubKeyHex/subjectHash required')
}
