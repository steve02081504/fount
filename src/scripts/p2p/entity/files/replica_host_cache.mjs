import fsp from 'node:fs/promises'

import { getAllUserNames } from '../../../../server/auth.mjs'
import { entityDir } from '../../user_paths.mjs'

/** @type {Map<string, { replica: string | null, at: number }>} */
const replicaHostCache = new Map()

const REPLICA_HOST_CACHE_MS = 60_000

/**
 * @param {string | string[]} [entityHash] owner（单个或批量）
 * @returns {void}
 */
export function invalidateReplicaHostCache(entityHash) {
	if (Array.isArray(entityHash)) {
		for (const eh of entityHash)
			replicaHostCache.delete(String(eh).trim().toLowerCase())
		return
	}
	if (entityHash) {
		replicaHostCache.delete(String(entityHash).trim().toLowerCase())
		return
	}
	replicaHostCache.clear()
}

/**
 * @param {string} ownerEntityHash owner
 * @returns {Promise<string | null>} 托管 manifest 的 replica
 */
export async function findReplicaHostingEntityFiles(ownerEntityHash) {
	const eh = String(ownerEntityHash).trim().toLowerCase()
	const cached = replicaHostCache.get(eh)
	if (cached && Date.now() - cached.at < REPLICA_HOST_CACHE_MS)
		return cached.replica

	for (const replica of getAllUserNames()) 
		try {
			await fsp.access(entityDir(replica, eh))
			replicaHostCache.set(eh, { replica, at: Date.now() })
			return replica
		}
		catch { /* next */ }
	
	replicaHostCache.set(eh, { replica: null, at: Date.now() })
	return null
}
