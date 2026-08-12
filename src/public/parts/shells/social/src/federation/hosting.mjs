/**
 * Social 实体托管解析：本机 replica 上的 user/agent entity。
 */
import { isEntityHash128, parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'

import {
	resolveAgentCharPartName,
	scanLocalAgentEntitiesFromChars as listLocalAgentEntities,
} from '../../../chat/src/entity/member.mjs'

import { getOperatorEntityHashProvider, getReplicaUsernamesProvider } from './follower/registry.mjs'

/**
 * 扫描本机 replica 上由 chars 托管的 agent 实体（重导出）。
 */
export { listLocalAgentEntities }

/**
 * Social 实体种类。
 * @typedef {'user' | 'agent' | 'unknown'} SocialEntityKind
 */

/**
 * 解析后的 Social 实体信息。
 * @typedef {object} ResolvedSocialEntity
 * @property {string} entityHash 128 位十六进制 entityHash
 * @property {SocialEntityKind} kind 实体种类
 * @property {boolean} local 是否托管在本 replica 节点
 * @property {string | null} replicaUsername 本机托管该实体时的 replica 登录名
 * @property {string | null} charPartName 本地 agent 时 chars/ 下目录名
 */

/**
 * 查找托管指定 entityHash 的本机 replica 登录名。
 * @param {string} entityHash 128 位 entityHash
 * @returns {Promise<string | null>} replica 登录名
 */
export async function findHostingReplicaUsername(entityHash) {
	if (!isEntityHash128(entityHash)) return null
	const parsed = parseEntityHash(entityHash)
	if (!parsed) return null

	const listReplicas = getReplicaUsernamesProvider()
	const resolveOperator = getOperatorEntityHashProvider()
	if (!listReplicas || !resolveOperator) return null

	for (const username of listReplicas()) {
		if (parsed.nodeHash !== getNodeHash()) continue
		const operator = await resolveOperator(username)
		if (operator === parsed.entityHash) return username
		if (resolveAgentCharPartName(username, parsed.entityHash)) return username
	}
	return null
}

/**
 * 解析 Social 实体：种类、是否本机托管及 chars 目录名等。
 * @param {string} entityHash 128 位 entityHash
 * @param {string | null} [hintReplicaUsername] 已知 replica 时可省略全量扫描
 * @returns {Promise<ResolvedSocialEntity | null>} 解析结果
 */
export async function resolveSocialEntity(entityHash, hintReplicaUsername = null) {
	const raw = entityHash
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
	const operator = resolveOperator ? await resolveOperator(replicaUsername) : null
	if (operator === parsed.entityHash)
		return {
			entityHash: parsed.entityHash,
			kind: 'user',
			local: true,
			replicaUsername,
			charPartName: null,
		}

	const charPartName = resolveAgentCharPartName(replicaUsername, parsed.entityHash) ?? null
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
