import {
	resolveLocalOperatorEntityHash,
} from '../../scripts/p2p/entity/replica.mjs'
import { getNodeHash } from '../../scripts/p2p/node_context.mjs'
import { getUserByReq } from '../auth.mjs'

import { getRecoveryPubKeyHex, resolveOperatorEntityHashForUser } from './operator_identity.mjs'

/**
 * @returns {string} 本节点 nodeHash
 */
export function getLocalNodeHash() {
	return getNodeHash()
}

/**
 * @param {string} replicaUsername fount 登录名
 * @returns {Promise<string | null>} operator entityHash
 */
export async function resolveOperatorEntityHash(replicaUsername) {
	return resolveOperatorEntityHashForUser(replicaUsername)
}

/**
 * @param {import('npm:express').Request} req 已 authenticate 的请求
 * @returns {Promise<{ replicaUsername: string, nodeHash: string, operatorEntityHash: string | null }>} replica 上下文
 */
export async function getReplicaFromReq(req) {
	const { username: replicaUsername } = await getUserByReq(req)
	const nodeHash = getNodeHash()
	const operatorEntityHash = await resolveOperatorEntityHashForUser(replicaUsername)
	return { replicaUsername, nodeHash, operatorEntityHash }
}

/**
 * @param {string} replicaUsername fount 登录名
 * @param {string} entityHash 目标 entityHash
 * @returns {Promise<boolean>} 当前用户是否可写该实体
 */
export async function isWritableLocalEntityForUser(replicaUsername, entityHash) {
	const { isWritableLocalEntity } = await import('../../scripts/p2p/entity/replica.mjs')
	if (!isWritableLocalEntity(entityHash)) return false
	const recoveryPub = await getRecoveryPubKeyHex(replicaUsername)
	const operatorHash = resolveLocalOperatorEntityHash(recoveryPub)
	return entityHash === operatorHash
}
