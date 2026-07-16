/**
 * 短视频竖屏流：含 video mediaRef 的公开帖，按 for_you 启发式排序。
 */
import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isEntityHashBlocked } from 'npm:@steve02081504/fount-p2p/node/denylist'
import { pickNodeScore } from 'npm:@steve02081504/fount-p2p/node/reputation_store'

import { discoverPosts } from './discover/local.mjs'
import { shouldHideAuthorByReputation } from './federation/reputation/index.mjs'
import { buildPostFeedItem } from './feed/buildItem.mjs'
import { buildEngagementIndex, loadViewerContext } from './feed/home.mjs'
import { createFeedItemBuildContext } from './feed/iterate.mjs'
import { scorePostForYou } from './feed/ranking.mjs'
import { canViewPost } from './feedVisibility.mjs'
import { isPublicDiscoverable } from './lib/visibilitySpec.mjs'
import { loadFollowingForActor } from './following.mjs'
import { computeTasteMatch, ensureTasteFresh } from './taste/cluster.mjs'
import { getTimelineMaterialized } from './timeline/materialize.mjs'

/**
 * @param {object} post 帖
 * @returns {boolean} 是否含视频
 */
function postHasVideo(post) {
	const refs = Array.isArray(post.content?.mediaRefs) ? post.content.mediaRefs : []
	return refs.some(ref => String(ref?.kind || '').toLowerCase() === 'video')
}

/**
 * @param {string} username replica
 * @param {{ limit?: number, cursor?: string, viewerEntityHash?: string }} [options] 分页
 * @returns {Promise<{ items: object[], nextCursor: string | null }>} 短视频流
 */
export async function buildVideosFeed(username, options = {}) {
	const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50)
	const viewer = options.viewerEntityHash || null
	const viewerContext = await loadViewerContext(username, viewer)
	const { following } = await loadFollowingForActor(username, viewer || viewerContext.viewerEntityHash)
	const feedSources = new Set(following)
	const taste = viewer ? await ensureTasteFresh(username, viewer) : null
	const engagement = await buildEngagementIndex(username, feedSources)
	const itemContext = await createFeedItemBuildContext(username, feedSources, viewer)

	/** @type {Map<string, { entityHash: string, post: object, score: number }>} */
	const scored = new Map()

	for (const entityHash of feedSources) {
		if (!isEntityHash128(entityHash)) continue
		if (isEntityHashBlocked(entityHash)) continue
		if (shouldHideAuthorByReputation(entityHash, pickNodeScore)) continue
		const view = await getTimelineMaterialized(username, entityHash)
		for (const post of view.posts || []) {
			if (!postHasVideo(post)) continue
			const enriched = { ...post, entityHash }
			if (!canViewPost(enriched, viewerContext)) continue
			if (!isPublicDiscoverable(enriched.content)) continue
			const affinity = 1
			const tasteMatch = taste ? computeTasteMatch(post, entityHash, taste) : 0
			const score = scorePostForYou(enriched, engagement, affinity, tasteMatch)
			scored.set(`${entityHash}:${post.id}`, { entityHash, post, score })
		}
	}

	try {
		const explore = await discoverPosts(username, { n: 40, mediaOnly: true })
		for (const row of explore.posts || []) {
			const entityHash = String(row.entityHash || '').toLowerCase()
			const postId = String(row.postId || '')
			if (!entityHash || !postId) continue
			const key = `${entityHash}:${postId}`
			if (scored.has(key)) continue
			const view = await getTimelineMaterialized(username, entityHash)
			const post = view.postById?.[postId]
			if (!post || !postHasVideo(post)) continue
			const enriched = { ...post, entityHash }
			if (!canViewPost(enriched, viewerContext)) continue
			const score = scorePostForYou(enriched, engagement, 0.5, taste ? computeTasteMatch(post, entityHash, taste) : 0) * 0.85
			scored.set(key, { entityHash, post: enriched, score })
		}
	}
	catch { /* explore 可选 */ }

	const ranked = [...scored.values()].sort((a, b) => b.score - a.score || String(b.post.id).localeCompare(String(a.post.id)))
	let start = 0
	if (options.cursor) {
		const idx = ranked.findIndex(row => `${row.entityHash}:${row.post.id}` === options.cursor)
		start = idx >= 0 ? idx + 1 : 0
	}
	const pageRows = ranked.slice(start, start + limit)
	const items = []
	for (const row of pageRows) {
		const item = await buildPostFeedItem(username, row.entityHash, row.post, itemContext)
		if (item) items.push({ ...item, score: row.score })
	}
	const nextCursor = pageRows.length === limit && start + limit < ranked.length
		? `${pageRows[pageRows.length - 1].entityHash}:${pageRows[pageRows.length - 1].post.id}`
		: null
	return { items, nextCursor }
}
