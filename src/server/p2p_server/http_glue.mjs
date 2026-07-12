import { resolveLogicalEntityId } from '../../scripts/p2p/entity/logical_entity_id_registry.mjs'
import {
	resolveLocalOperatorEntityHash,
} from '../../scripts/p2p/entity/replica.mjs'
import { getNodeHash } from '../../scripts/p2p/node/identity.mjs'
import { resolveGroupMemberEntityHash } from '../../scripts/p2p/p2p_viewer_registry.mjs'
import { getUserByReq } from '../auth/index.mjs'

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
	const { username: replicaUsername } = getUserByReq(req)
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

/**
 * @param {string} replicaUsername fount 登录名
 * @param {string | null} operatorEntityHash operator entityHash
 * @param {string} entityHash 目标 entityHash
 * @param {string | undefined} groupIdOpt 可选群上下文
 * @returns {Promise<boolean>} 是否可读 stats
 */
export async function canReadEntityStats(replicaUsername, operatorEntityHash, entityHash, groupIdOpt) {
	if (entityHash === operatorEntityHash) return true
	if (await isWritableLocalEntityForUser(replicaUsername, entityHash)) return true

	const groupId = groupIdOpt || await resolveLogicalEntityId(replicaUsername, entityHash)
	if (!groupId) return false

	const viewerMemberHash = await resolveGroupMemberEntityHash(replicaUsername, groupId)
	if (!viewerMemberHash) return false
	if (entityHash === viewerMemberHash) return true

	const entityGroupId = await resolveLogicalEntityId(replicaUsername, entityHash)
	return entityGroupId === groupId
}
