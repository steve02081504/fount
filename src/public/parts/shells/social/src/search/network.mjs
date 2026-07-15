/**
 * 联邦帖文搜索 part_query。
 */
import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'
import { getShellPartpath } from 'npm:@steve02081504/fount-p2p/registries/part_path'
import { queryNetwork, registerQueryInboundHandler } from 'npm:@steve02081504/fount-p2p/wire/part_query'

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
	return result.items.map(item => ({
		entityHash: item.entityHash,
		postId: item.postId,
		text: String(item.post?.content?.text || '').slice(0, 500),
		hlc: item.hlc || item.post?.hlc || null,
		mediaRefs: (item.post?.content?.mediaRefs || []).slice(0, 4),
		nodeHash,
		event: item.post ? {
			id: item.post.id,
			type: 'post',
			content: {
				text: item.post.content?.text,
				mediaRefs: item.post.content?.mediaRefs,
				visibility: item.post.content?.visibility === 'followers' ? 'public' : item.post.content?.visibility,
				tags: item.post.content?.tags,
			},
			hlc: item.post.hlc,
			timestamp: item.post.timestamp,
			signer: item.post.signer,
			signature: item.post.signature,
		} : null,
	})).filter(row => row.event && row.entityHash && row.postId)
}

/**
 * @returns {void}
 */
export function registerSocialPostSearchQueryHandler() {
	registerQueryInboundHandler(getShellPartpath('social'), POST_SEARCH_KIND, localPostSearchHandler)
}

/**
 * @returns {void}
 */
export function unregisterSocialPostSearchQueryHandler() {
	registerQueryInboundHandler(getShellPartpath('social'), POST_SEARCH_KIND, () => [])
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
		/**
		 * @param {object} row 搜索行
		 * @returns {string} 去重键
		 */
		rowKey: row => {
			if (!row || typeof row !== 'object') return ''
			const entityHash = String(row.entityHash || '').toLowerCase()
			const postId = String(row.postId || '')
			return entityHash && postId ? `${entityHash}:${postId}` : ''
		},
	})

	/** @type {object[]} */
	const items = []
	for (const raw of rows) {
		if (!raw || typeof raw !== 'object') continue
		const entityHash = String(raw.entityHash || '').trim().toLowerCase()
		const postId = String(raw.postId || '').trim()
		const event = raw.event
		if (!entityHash || !postId || !event) continue
		// 入站清洗：仅公开可见摘录，不信任密文字段
		if (event.content?.visibility === 'followers') continue
		items.push({
			entityHash,
			postId,
			hlc: event.hlc || raw.hlc || null,
			post: {
				...event,
				id: postId,
				content: {
					text: String(event.content?.text || '').slice(0, 2000),
					mediaRefs: Array.isArray(event.content?.mediaRefs) ? event.content.mediaRefs.slice(0, 16) : [],
					visibility: 'public',
					tags: Array.isArray(event.content?.tags) ? event.content.tags.slice(0, 16) : undefined,
				},
			},
			federated: true,
			nodeHash: String(raw.nodeHash || '').toLowerCase(),
		})
		if (items.length >= limit) break
	}
	return { query: q, items, nextCursor: null, scope: 'nearby' }
}
