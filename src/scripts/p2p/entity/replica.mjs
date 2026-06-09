import { getUserByReq } from '../../../server/auth.mjs'
import { parseEntityHash, userEntityHashFromPubKeyHex } from '../entity_id.mjs'
import { getFederationSettings, ensureNodeSeed } from '../federation/identity.mjs'
import { isHex64 } from '../hexIds.mjs'

import { nodeHashFromSeed } from './node_hash.mjs'

/**
 * @param {string} replicaUsername replica 所有者
 * @returns {string} 本节点 nodeHash（由持久化 nodeSeed 派生）
 */
export function getLocalNodeHash(replicaUsername) {
	if (!replicaUsername) throw new Error('replicaUsername required for getLocalNodeHash')
	return nodeHashFromSeed(ensureNodeSeed(replicaUsername))
}

/**
 * @param {string} replicaUsername replica 所有者
 * @returns {string | null} 本节点操作者 entityHash
 */
export function resolveOperatorEntityHash(replicaUsername) {
	const { identityPubKeyHex } = getFederationSettings(replicaUsername)
	if (!isHex64(identityPubKeyHex)) return null
	return userEntityHashFromPubKeyHex(getLocalNodeHash(replicaUsername), identityPubKeyHex)
}

/**
 * @param {string} replicaUsername replica 所有者
 * @returns {string} 本节点操作者 entityHash
 */
export function getOperatorEntityHash(replicaUsername) {
	const entityHash = resolveOperatorEntityHash(replicaUsername)
	if (!entityHash)
		throw new Error('configure identityPubKeyHex in federation settings first')
	return entityHash
}

/**
 * @param {import('npm:express').Request} req 已 authenticate 的请求
 * @returns {Promise<{ replicaUsername: string, nodeHash: string, operatorEntityHash: string | null }>} replica 上下文
 */
export async function getReplicaFromReq(req) {
	const { username: replicaUsername } = await getUserByReq(req)
	const nodeHash = getLocalNodeHash(replicaUsername)
	return {
		replicaUsername,
		nodeHash,
		operatorEntityHash: resolveOperatorEntityHash(replicaUsername),
	}
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} entityHash 目标 entityHash
 * @returns {boolean} 是否为本 replica 可写实体
 */
export function isWritableLocalEntity(replicaUsername, entityHash) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed) return false
	return parsed.nodeHash === getLocalNodeHash(replicaUsername)
}
