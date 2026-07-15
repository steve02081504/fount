/**
 * 多跳帖文发现 part_query（无查询词，newest-first，带完整签名 event）。
 */
import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'
import { getShellPartpath } from 'npm:@steve02081504/fount-p2p/registries/part_path'
import { queryNetwork, registerQueryInboundHandler } from 'npm:@steve02081504/fount-p2p/wire/part_query'

import { getTimelineMaterialized } from '../timeline/materialize.mjs'

import { discoverPosts } from './local.mjs'

/**
 *
 */
export const POST_DISCOVER_KIND = 'post_discover'

/**
 * @param {{ replicaUsername?: string }} ctx 入站上下文
 * @param {unknown} query 查询
 * @returns {Promise<object[]>} 行
 */
export async function localPostDiscoverHandler(ctx, query) {
	const username = String(ctx.replicaUsername || '').trim()
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
		if (!post || post.content?.visibility === 'followers') continue
		rows.push({
			entityHash,
			postId,
			text: String(post.content?.text || '').slice(0, 500),
			hlc: post.hlc || null,
			mediaRefs: (post.content?.mediaRefs || []).slice(0, 4),
			nodeHash,
			event: {
				id: post.id,
				type: 'post',
				content: {
					text: post.content?.text,
					mediaRefs: post.content?.mediaRefs,
					visibility: 'public',
					tags: post.content?.tags,
				},
				hlc: post.hlc,
				timestamp: post.timestamp,
				signer: post.signer,
				signature: post.signature,
			},
		})
	}
	return rows
}

/** @returns {void} */
export function registerSocialPostDiscoverQueryHandler() {
	registerQueryInboundHandler(getShellPartpath('social'), POST_DISCOVER_KIND, localPostDiscoverHandler)
}

/** @returns {void} */
export function unregisterSocialPostDiscoverQueryHandler() {
	registerQueryInboundHandler(getShellPartpath('social'), POST_DISCOVER_KIND, () => [])
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
		/**
		 * @param {unknown} row 查询行
		 * @returns {string} 去重键
		 */
		rowKey: row => {
			if (!row || typeof row !== 'object') return ''
			const entityHash = String(/** @type {{ entityHash?: unknown }} */row.entityHash || '').toLowerCase()
			const postId = String(/** @type {{ postId?: unknown }} */row.postId || '')
			return entityHash && postId ? `${entityHash}:${postId}` : ''
		},
	})

	/** @type {{ entityHash: string, postId: string, event: object }[]} */
	const items = []
	for (const raw of rows) {
		if (!raw || typeof raw !== 'object') continue
		const entityHash = String(/** @type {{ entityHash?: unknown }} */raw.entityHash || '').trim().toLowerCase()
		const postId = String(/** @type {{ postId?: unknown }} */raw.postId || '').trim()
		const event = /** @type {{ event?: object }} */raw.event
		if (!entityHash || !postId || !event) continue
		if (event.content?.visibility === 'followers') continue
		if (mediaOnly && !(Array.isArray(event.content?.mediaRefs) && event.content.mediaRefs.length)) continue
		items.push({
			entityHash,
			postId,
			event: {
				...event,
				id: postId,
				type: 'post',
				content: {
					text: String(event.content?.text || '').slice(0, 2000),
					mediaRefs: Array.isArray(event.content?.mediaRefs) ? event.content.mediaRefs.slice(0, 16) : [],
					visibility: 'public',
					tags: Array.isArray(event.content?.tags) ? event.content.tags.slice(0, 16) : undefined,
				},
			},
		})
		if (items.length >= limit) break
	}
	return { items }
}
