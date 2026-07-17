/**
 * 联邦帖文搜索 part_query。
 */
import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'
import { getShellPartpath } from 'npm:@steve02081504/fount-p2p/registries/part_path'
import { queryNetwork } from 'npm:@steve02081504/fount-p2p/wire/part_query'

import { federatedPostQueryRow, federatedPostRowKey, sanitizeFederatedPostQueryRow } from '../federation/postQueryRow.mjs'
import { searchPosts } from '../search.mjs'

/** part_query kind：联邦帖文搜索 */
export const POST_SEARCH_KIND = 'post_search'

/**
 * @param {{ replicaUsername?: string }} apiContext 入站上下文
 * @param {unknown} query 查询
 * @returns {Promise<object[]>} 行
 */
export async function localPostSearchHandler(apiContext, query) {
	const username = String(apiContext.replicaUsername || '').trim()
	if (!username) return []
	const { q: rawQ, limit: rawLimit, author, media, tag } = query && typeof query === 'object'
		? /** @type {{ q?: unknown, limit?: unknown, author?: unknown, media?: unknown, tag?: unknown }} */ query
		: {}
	const q = String(rawQ || '').trim()
	const limit = Math.min(Math.max(Number(rawLimit) || 20, 1), 32)
	const result = await searchPosts(username, {
		q,
		limit,
		author,
		media,
		tag,
		scope: 'local',
	})
	const nodeHash = String(getNodeHash() || '').toLowerCase()
	return result.items
		.map(item => federatedPostQueryRow(item.post, item.entityHash, nodeHash, { visibilityMode: 'preserve' }))
		.filter(Boolean)
}

/**
 * @param {string} username replica
 * @param {object} [options] 选项
 * @returns {Promise<{ query: string, items: object[], nextCursor: null, scope: 'nearby' }>} 附近搜索
 */
export async function buildNearbyPostSearch(username, options = {}) {
	const q = String(options.q || '').trim()
	const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100)
	const partpath = getShellPartpath('social')
	const rows = await queryNetwork(username, partpath, POST_SEARCH_KIND, {
		q,
		limit,
		author: options.author,
		media: options.media,
		tag: options.tag,
	}, {
		maxHits: 64,
		rowKey: federatedPostRowKey,
	})

	/** @type {object[]} */
	const items = []
	for (const raw of rows) {
		const cleaned = sanitizeFederatedPostQueryRow(raw)
		if (!cleaned) continue
		items.push({
			entityHash: cleaned.entityHash,
			postId: cleaned.postId,
			hlc: cleaned.hlc,
			post: cleaned.event,
			federated: true,
			nodeHash: cleaned.nodeHash,
		})
		if (items.length >= limit) break
	}
	return { query: q, items, nextCursor: null, scope: 'nearby' }
}
