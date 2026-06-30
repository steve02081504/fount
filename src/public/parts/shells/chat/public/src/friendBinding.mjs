/**
 * 【文件】public/src/friendBinding.mjs
 * 【职责】好友绑定模型：规范化 entityHash、构建角色/用户 FriendBinding。
 * 【原理】agentEntityHash/userEntityHashFromPubKeyHex 计算 128 位 hash；normalizeFriendBinding 校验字段。
 * 【数据结构】FriendBinding { entityHash, displayName?, charname? }。
 * 【关联】api/groupFriendBinding.mjs、entityId.mjs；Hub 好友私聊频道。
 */
import { isEntityHash128 } from './lib/entityHash.mjs'
import { agentEntityHash, userEntityHashFromPubKeyHex } from './lib/entityId.mjs'
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
 * @param {string} [peer.pubKeyHex] 对端公钥（无 entityHash 时推导）
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

	const pubKeyHex = normalizeHex64(peer?.pubKeyHex || '')
	if (!isHex64(pubKeyHex)) throw new Error('peer entityHash or pubKeyHex required')
	return {
		entityHash: await userEntityHashFromPubKeyHex(pubKeyHex, pubKeyHex),
		...peer.displayName ? { displayName: String(peer.displayName).trim() } : {},
	}
}
