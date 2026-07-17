/**
 * 多跳帖文发现 part_query（无查询词，newest-first，带完整签名 event）。
 */
import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'
import { getShellPartpath } from 'npm:@steve02081504/fount-p2p/registries/part_path'
import { queryNetwork } from 'npm:@steve02081504/fount-p2p/wire/part_query'

import { federatedPostQueryRow, federatedPostRowKey, sanitizeFederatedPostQueryRow } from '../federation/postQueryRow.mjs'
import { isPublicDiscoverable } from '../lib/visibilitySpec.mjs'
import { getTimelineMaterialized } from '../timeline/materialize.mjs'

import { discoverPosts } from './local.mjs'

/**
 *
 */
export const POST_DISCOVER_KIND = 'post_discover'

/**
 * @param {{ replicaUsername?: string }} inboundContext 入站上下文
 * @param {unknown} query 查询
 * @returns {Promise<object[]>} 行
 */
export async function localPostDiscoverHandler(inboundContext, query) {
	const username = String(inboundContext.replicaUsername || '').trim()
	if (!username) return []
	const limit = Math.min(Math.max(Number(
		query && typeof query === 'object' ? /** @type {{ limit?: unknown }} */query.limit : 20,
	) || 20, 1), 32)
	const mediaOnly = query && typeof query === 'object'
		&& /** @type {{ mediaOnly?: unknown }} */query.mediaOnly === true
	const { posts } = await discoverPosts(username, { n: limit, mediaOnly })
	const nodeHash = String(getNodeHash() || '').toLowerCase()
	/** @type {object[]} */
	const rows = []
	for (const row of posts) {
		const entityHash = String(row.entityHash || '').toLowerCase()
		const postId = String(row.postId || '')
		if (!entityHash || !postId) continue
		const view = await getTimelineMaterialized(username, entityHash)
		const post = view.postById?.[postId]
		if (!post || !isPublicDiscoverable(post.content)) continue
		const federated = federatedPostQueryRow(post, entityHash, nodeHash)
		if (federated) rows.push(federated)
	}
	return rows
}

/**
 * 多跳收集公开帖并返回可 ingest 的条目。
 * @param {string} username replica
 * @param {{ limit?: number, mediaOnly?: boolean, ttl?: number }} [options] 选项
 * @returns {Promise<{ items: { entityHash: string, postId: string, event: object }[] }>} 附近发现
 */
export async function collectNearbyPostDiscover(username, options = {}) {
	const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50)
	const mediaOnly = options.mediaOnly === true
	const rows = await queryNetwork(username, getShellPartpath('social'), POST_DISCOVER_KIND, {
		limit,
		mediaOnly,
	}, {
		ttl: Number(options.ttl) || 3,
		maxHits: 64,
		rowKey: federatedPostRowKey,
	})

	/** @type {{ entityHash: string, postId: string, event: object }[]} */
	const items = []
	for (const raw of rows) {
		const cleaned = sanitizeFederatedPostQueryRow(raw, { mediaOnly })
		if (!cleaned) continue
		items.push({
			entityHash: cleaned.entityHash,
			postId: cleaned.postId,
			event: cleaned.event,
		})
		if (items.length >= limit) break
	}
	return { items }
}
