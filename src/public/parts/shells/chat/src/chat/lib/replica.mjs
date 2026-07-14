/**
 * 【文件】src/chat/lib/replica.mjs
 * 【职责】replica 上下文与群成员 entityHash；用户 operator 见 server/p2p_server。
 */
import { pubKeyHash, publicKeyFromSeed } from 'npm:@steve02081504/fount-p2p/crypto'
import { isWritableLocalEntity } from 'npm:@steve02081504/fount-p2p/node/identity'
import { encodeEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'
import { getReplicaFromReq, isWritableLocalEntityForUser } from '../../entity/http.mjs'
import {
	getOperatorEntityHash,
	resolveOperatorEntityHashForUser,
} from '../../entity/identity.mjs'
import { readLocalSignerSeed } from '../dag/localSigner.mjs'

/**
 * @returns {string} 本节点 nodeHash（节点级单例）
 */
export function getLocalNodeHash() {
	return getNodeHash()
}

/**
 * @param {string} replicaUsername replica 所有者
 * @returns {Promise<string | null>} operator entityHash
 */
export function resolveOperatorEntityHash(replicaUsername) {
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
