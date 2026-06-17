import {
	resolveLocalOperatorEntityHash,
} from '../../scripts/p2p/entity/replica.mjs'
import { getNodeHash } from '../../scripts/p2p/node_context.mjs'
import { getUserByReq } from '../auth.mjs'

import { ensureOperatorPubKey, resolveOperatorEntityHashForUser } from './operator_identity.mjs'

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
 * @returns {Promise<{ replicaUsername: string, nodeHash: string, operatorEntityHash: string | null }>}
 */
export async function getReplicaFromReq(req) {
	const { username: replicaUsername } = await getUserByReq(req)
	const nodeHash = getNodeHash()
	const operatorEntityHash = await resolveOperatorEntityHashForUser(replicaUsername)
	return { replicaUsername, nodeHash, operatorEntityHash }
}

/**
 * @param {string} replicaUsername
 * @param {string} entityHash
 * @returns {Promise<boolean>}
 */
export async function isWritableLocalEntityForUser(replicaUsername, entityHash) {
	const { isWritableLocalEntity } = await import('../../scripts/p2p/entity/replica.mjs')
	if (!isWritableLocalEntity(entityHash)) return false
	const pub = await ensureOperatorPubKey(replicaUsername)
	const operatorHash = resolveLocalOperatorEntityHash(pub)
	r