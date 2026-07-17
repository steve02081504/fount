import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'

import { getUserByReq } from '../../../../../../server/auth/index.mjs'

import { resolveCharPartNameForEntity, resolveOperatorEntityHashForUser } from './identity.mjs'
import { resolveLogicalEntityId } from './logicalId.mjs'
import { resolveGroupMemberEntityHash } from './viewerResolve.mjs'

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
 * 当前用户在某已加入群中的活跃群成员 persona 是否匹配 target。
 * @param {string} replicaUsername fount 登录名
 * @param {string} target 小写 entityHash
 * @returns {Promise<boolean>} 是否为本用户活跃群 persona
 */
async function isActiveGroupMemberPersonaForUser(replicaUsername, target) {
	const { listUserGroups } = await import('../chat/lib/userGroups.mjs')
	const { getState } = await import('../chat/dag/materialize.mjs')
	const { resolveActiveMemberKeyForLocalUser } = await import('../group/access.mjs')
	for (const groupId of await listUserGroups(replicaUsername)) 
		try {
			const memberHash = await resolveGroupMemberEntityHash(replicaUsername, groupId)
			if (String(memberHash || '').toLowerCase() !== target) continue
			const { state } = await getState(replicaUsername, groupId, { skipLeftPurge: true })
			if (await resolveActiveMemberKeyForLocalUser(replicaUsername, groupId, state))
				return true
		}
		catch { /* 非成员 / 未物化 */ }
	
	return false
}

/**
 * @param {string} replicaUsername fount 登录名
 * @param {string} entityHash 目标 entityHash
 * @returns {Promise<boolean>} 当前用户是否可写该实体
 */
export async function isWritableLocalEntityForUser(replicaUsername, entityHash) {
	const { isWritableLocalEntity } = await import('npm:@steve02081504/fount-p2p/node/identity')
	if (!isWritableLocalEntity(entityHash)) return false
	const target = String(entityHash || '').toLowerCase()
	const operatorHash = await resolveOperatorEntityHashForUser(replicaUsername)
	if (target === operatorHash) return true
	if (await resolveCharPartNameForEntity(replicaUsername, target) != null) return true
	return await isActiveGroupMemberPersonaForUser(replicaUsername, target)
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
