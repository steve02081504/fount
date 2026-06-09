/**
 * 【文件】src/chat/lib/replica.mjs
 * 【职责】replica 上下文与群成员 entityHash；identity 相关函数见 scripts/p2p/entity/replica.mjs。
 */
import { pubKeyHash, publicKeyFromSeed } from '../../../../../../../scripts/p2p/crypto.mjs'
import {
	getLocalNodeHash,
	getOperatorEntityHash,
	getReplicaFromReq,
	isWritableLocalEntity,
	resolveOperatorEntityHash,
} from '../../../../../../../scripts/p2p/entity/replica.mjs'
import { encodeEntityHash } from '../../../../../../../scripts/p2p/entity_id.mjs'
import { readLocalSignerSeed } from '../dag/localSigner.mjs'

/**
 *
 */
export {
	getLocalNodeHash,
	getOperatorEntityHash,
	getReplicaFromReq,
	isWritableLocalEntity,
	resolveOperatorEntityHash,
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} groupId 群 ID
 * @returns {Promise<string>} 本群成员 entityHash
 */
export async function getGroupMemberEntityHash(replicaUsername, groupId) {
	const nodeHash = getLocalNodeHash(replicaUsername)
	const seed = await readLocalSignerSeed(replicaUsername, groupId)
	const subjectHash = pubKeyHash(publicKeyFromSeed(seed))
	return encodeEntityHash(nodeHash, subjectHash)
}
