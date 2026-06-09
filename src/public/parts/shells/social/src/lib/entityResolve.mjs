/**
 * Social 实体解析：Social 账号 = Chat 账号 = fount P2P 实体（128 位 entityHash）。
 * 无需单独注册；用户身份来自 Chat 联邦 identity，agent 来自本机 chars/ part。
 */
import fs from 'node:fs'
import path from 'node:path'

import { resolveAgentCharPartName } from '../../../../../../scripts/p2p/entity/agentResolve.mjs'
import { getLocalNodeHash, resolveOperatorEntityHash } from '../../../../../../scripts/p2p/entity/replica.mjs'
import {
	agentEntityHash,
	isEntityHash128,
	parseEntityHash,
} from '../../../../../../scripts/p2p/entity_id.mjs'
import { getAllUserNames, getUserDictionary } from '../../../../../../server/auth.mjs'

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
 * 列出本 replica 上托管的全部 agent 实体。
 * @param {string} replicaUsername replica 登录名
 * @returns {{ entityHash: string, charPartName: string }[]} 本机 agent 实体列表
 */
export function listLocalAgentEntities(replicaUsername) {
	const nodeHash = getLocalNodeHash(replicaUsername)
	const charsRoot = path.join(getUserDictionary(replicaUsername), 'chars')
	if (!fs.existsSync(charsRoot)) return []
	/** @type {{ entityHash: string, charPartName: string }[]} */
	const agents = []
	for (const ent of fs.readdirSync(charsRoot, { withFileTypes: true })) {
		if (!ent.isDirectory()) continue
		const partPath = `chars/${ent.name}`
		agents.push({
			charPartName: ent.name,
			entityHash: agentEntityHash(nodeHash, partPath),
		})
	}
	return agents
}

/**
 * 查找托管该 entityHash 的本机 replica（用户或 agent 资料目录）。
 * @param {string} entityHash 128 位 entityHash
 * @returns {string | null} replica 登录名
 */
export function findHostingReplicaUsername(entityHash) {
	if (!isEntityHash128(entityHash)) return null
	const parsed = parseEntityHash(entityHash)
	if (!parsed) return null

	for (const username of getAllUserNames()) {
		if (parsed.nodeHash !== getLocalNodeHash(username)) continue
		const operator = resolveOperatorEntityHash(username)
		if (operator?.toLowerCase() === parsed.entityHash) return username
		if (resolveAgentCharPartName(username, parsed.entityHash)) return username
	}
	return null
}

/**
 * 解析 entityHash 对应的 Social 实体类型与托管信息。
 * @param {string} entityHash 128 位 entityHash
 * @param {string | null} [hintReplicaUsername] 已知 replica 时可省略全量扫描
 * @returns {ResolvedSocialEntity | null} 解析结果
 */
export function resolveSocialEntity(entityHash, hintReplicaUsername = null) {
	const raw = String(entityHash || '').trim().toLowerCase()
	if (!isEntityHash128(raw)) return null
	const parsed = parseEntityHash(raw)
	if (!parsed) return null

	const replicaUsername = hintReplicaUsername || findHostingReplicaUsername(parsed.entityHash)
	const local = !!replicaUsername
	if (!local)
		return {
			entityHash: parsed.entityHash,
			kind: 'unknown',
			local: false,
			replicaUsername: null,
			charPartName: null,
		}


	const operator = resolveOperatorEntityHash(replicaUsername)
	if (operator?.toLowerCase() === parsed.entityHash)
		return {
			entityHash: parsed.entityHash,
			kind: 'user',
			local: true,
			replicaUsername,
			charPartName: null,
		}


	const charPartName = resolveAgentCharPartName(replicaUsername, parsed.entityHash)
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
