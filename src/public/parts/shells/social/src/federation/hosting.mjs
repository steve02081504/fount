/**
 * Social 实体托管解析：本机 replica 上的 user/agent entity。
 */
import { isEntityHash128, parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import {
	getAgentCharResolver,
	getListLocalAgentsProvider,
} from 'npm:@steve02081504/fount-p2p/entity/hosting_registry'
import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'

import { getOperatorEntityHashProvider, getReplicaUsernamesProvider } from './follower_index_registry.mjs'

/**
 * @typedef {'user' | 'agent' | 'unknown'} SocialEntityKind
 * @typedef {object} ResolvedSocialEntity
 * @property {string} entityHash 128 hex
 * @property {SocialEntityKind} kind
 * @property {boolean} local 是否托管在本 replica 节点
 * @property {string | null} replicaUsername 本机托管该实体时的 replica 登录名
 * @property {string | null} charPartName 本地 agent 时 chars/ 下目录名
 */

/**
 * @param {string} replicaUsername replica 登录名
 * @returns {{ entityHash: string, charPartName: string }[]} 本地 agent 列表
 */
export function listLocalAgentEntities(replicaUsername) {
	const provider = getListLocalAgentsProvider()
	return provider ? provider(replicaUsername) : []
}

/**
 * @param {string} entityHash 128 位 entityHash
 * @returns {Promise<string | null>} replica 登录名
 */
export async function findHostingReplicaUsername(entityHash) {
	if (!isEntityHash128(entityHash)) return null
	const parsed = parseEntityHash(entityHash)
	if (!parsed) return null

	const listReplicas = getReplicaUsernamesProvider()
	const resolveOperator = getOperatorEntityHashProvider()
	const resolveAgent = getAgentCharResolver()
	if (!listReplicas || !resolveOperator) return null

	for (const username of listReplicas()) {
		if (parsed.nodeHash !== getNodeHash()) continue
		const operator = await resolveOperator(username)
		if (operator?.toLowerCase() === parsed.entityHash) return username
		if (resolveAgent?.(username, parsed.entityHash)) return username
	}
	return null
}

/**
 * @param {string} entityHash 128 位 entityHash
 * @param {string | null} [hintReplicaUsername] 已知 replica 时可省略全量扫描
 * @returns {Promise<ResolvedSocialEntity | null>} 解析结果
 */
export async function resolveSocialEntity(entityHash, hintReplicaUsername = null) {
	const raw = String(entityHash || '').trim().toLowerCase()
	if (!isEntityHash128(raw)) return null
	const parsed = parseEntityHash(raw)
	if (!parsed) return null

	const replicaUsername = hintReplicaUsername || await findHostingReplicaUsername(parsed.entityHash)
	const local = !!replicaUsername
	if (!local)
		return {
			entityHash: parsed.entityHash,
			kind: 'unknown',
			local: false,
			replicaUsername: null,
			charPartName: null,
		}

	const resolveOperator = getOperatorEntityHashProvider()
	const resolveAgent = getAgentCharResolver()
	const operator = resolveOperator ? await resolveOperator(replicaUsername) : null
	if (operator?.toLowerCase() === parsed.entityHash)
		return {
			entityHash: parsed.entityHash,
			kind: 'user',
			local: true,
			replicaUsername,
			charPartName: null,
		}

	const charPartName = resolveAgent?.(replicaUsername, parsed.entityHash) ?? null
	if (charPartName)
		return {
			entityHash: parsed.entityHash,
			kind: 'agent',
			local: true,
			replicaUsername,
			charPartName,
		}

	return {
		entityHash: parsed.entityHash,
		kind: 'unknown',
		local: true,
		replicaUsername: null,
		charPartName: null,
	}
}
