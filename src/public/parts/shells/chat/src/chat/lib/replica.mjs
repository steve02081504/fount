/**
 * 【文件】src/chat/lib/replica.mjs
 * 【职责】replica 上下文与群成员 entityHash；用户 operator 见 server/p2p_server。
 */
import { pubKeyHash, publicKeyFromSeed } from '../../../../../../../scripts/p2p/crypto.mjs'
import { encodeEntityHash } from '../../../../../../../scripts/p2p/entity_id.mjs'
import { getNodeHash } from '../../../../../../../scripts/p2p/node_context.mjs'
import { isWritableLocalEntity } from '../../../../../../../scripts/p2p/entity/replica.mjs'
import { getReplicaFromReq, isWritableLocalEntityForUser } from '../../../../../../../server/p2p_server/http_glue.mjs'
import {
	getOperatorEntityHash,
	resolveOperatorEntityHashForUser,
} from '../../../../../../../server/p2p_server/operator_identity.mjs'
import { readLocalSignerSeed } from '../dag/localSigner.mjs'

/**
 * @param {string} [_replicaUsername] 忽略（节点级单例）
 * @returns {string} 本节点 nodeHash
 */
export function getLocalNodeHash(_replicaUsername) {
	void _replicaUsername
	return getNodeHash()
}

/**
 * @param {string} replicaUsername replica 所有者
 * @returns {Promise<string | null>} operator entityHash
 */
export async function resolveOperatorEntityHash(replicaUsername) {
	return resolveOperatorEntityHashForUser(replicaUsername)
}

/**
 *
 */
export {
	getOperatorEntityHash,
	getReplicaFromReq,
	isWritableLocalEntity,
	isWritableLocalEntityForUser,
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} groupId 群 ID
 * @returns {Promise<string>} 本群成员 entityHash
 */
export async function getGroupMemberEntityHash(replicaUsername, groupId) {
	const nodeHash = getNodeHash()
	const seed = await readLocalSignerSeed(replicaUsername, groupId)
	const subjectHash = pubKeyHash(publicKeyFromSeed(seed))
	return encodeEntityHash(nodeHash, subjectHash)
}
