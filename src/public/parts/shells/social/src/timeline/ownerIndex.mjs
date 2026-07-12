import { readdir } from 'node:fs/promises'

import { createLruMap } from '../../../../../../scripts/memo.mjs'
import { isEntityHash128, parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { getUserDictionary } from '../../../../../../server/auth/index.mjs'

const INDEX_CACHE_MAX = 64

/**
 * @typedef {{ all: string[], byNode: Map<string, string[]> }} TimelineOwnerIndex
 */

/** @type {ReturnType<typeof createLruMap<TimelineOwnerIndex>>} */
const indexByUser = createLruMap(INDEX_CACHE_MAX)

/**
 * @param {string} username replica 登录名
 * @returns {string} timelines 根目录
 */
function timelinesRoot(username) {
	return `${getUserDictionary(username)}/shells/social/timelines`
}

/**
 * @param {string} username replica 登录名
 * @returns {Promise<TimelineOwnerIndex>} 重建索引
 */
async function rebuildTimelineOwnerIndex(username) {
	/** @type {string[]} */
	const all = []
	/** @type {Map<string, string[]>} */
	const byNode = new Map()
	try {
		const entries = await readdir(timelinesRoot(username), { withFileTypes: true })
		for (const entry of entries) {
			if (!entry.isDirectory()) continue
			const entityHash = entry.name.toLowerCase()
			if (!isEntityHash128(entityHash)) continue
			const parsed = parseEntityHash(entityHash)
			if (!parsed) continue
			all.push(entityHash)
			let list = byNode.get(parsed.nodeHash)
			if (!list) {
				list = []
				byNode.set(parsed.nodeHash, list)
			}
			list.push(entityHash)
		}
		all.sort()
		for (const list of byNode.values())
			list.sort()
	}
	catch { /* missing root */ }
	return { all, byNode }
}

/**
 * @param {string} username replica 登录名
 * @returns {void}
 */
export function invalidateTimelineOwnerIndex(username) {
	indexByUser.delete(username)
}

/**
 * @param {string} username replica 登录名
 * @returns {Promise<TimelineOwnerIndex>} 本地 timeline owner 索引
 */
export async function getTimelineOwnerIndex(username) {
	let index = indexByUser.get(username)
	if (!index) {
		index = await rebuildTimelineOwnerIndex(username)
		indexByUser.touch(username, index)
	}
	else indexByUser.touch(username, index)
	return index
}

/**
 * @param {string} username replica 登录名
 * @param {string} nodeHash 64 hex
 * @returns {Promise<string[]>} 该节点在本 replica 托管的 entityHash
 */
export async function listLocalEntitiesForNode(username, nodeHash) {
	const key = nodeHash?.toLowerCase()
	if (!key) return []
	return [...(await getTimelineOwnerIndex(username)).byNode.get(key) || []]
}
