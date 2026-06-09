import fs from 'node:fs'
import path from 'node:path'

import { getUserDictionary } from '../../../server/auth.mjs'
import { agentEntityHash, parseEntityHash } from '../entity_id.mjs'

import { getLocalNodeHash } from './replica.mjs'

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} entityHash 128 位 agent entityHash
 * @returns {string | null} 角色 part 名
 */
export function resolveAgentCharPartName(replicaUsername, entityHash) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed) return null
	const nodeHash = getLocalNodeHash(replicaUsername)
	if (parsed.nodeHash !== nodeHash) return null
	const charsRoot = path.join(getUserDictionary(replicaUsername), 'chars')
	if (!fs.existsSync(charsRoot)) return null
	for (const ent of fs.readdirSync(charsRoot, { withFileTypes: true })) {
		if (!ent.isDirectory()) continue
		const partPath = `chars/${ent.name}`
		if (agentEntityHash(nodeHash, partPath) === parsed.entityHash)
			return ent.name
	}
	return null
}
