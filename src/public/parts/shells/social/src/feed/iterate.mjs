import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isEntityHashBlocked } from 'npm:@steve02081504/fount-p2p/node/denylist'
import { pickNodeScore } from 'npm:@steve02081504/fount-p2p/node/reputation_store'

import { shouldHideAuthorByReputation } from '../federation/reputation/index.mjs'
import { canViewPost } from '../feedVisibility.mjs'
import { listFollowedTimelineOwners } from '../following.mjs'
import { albumsForPostFromView } from '../lib/albumRefs.mjs'
import { createAuthorProfileLoader } from '../lib/authorProfileSummary.mjs'
import { getTimelineMaterialized } from '../timeline/materialize.mjs'

import { createEngagementForPost } from './buildItem.mjs'
import {
	buildEngagementIndex,
	buildViewerDislikedSet,
	buildViewerLikedSet,
	loadViewerContext,
} from './home.mjs'

/**
 * @param {string} username 用户
 * @param {Iterable<string>} [owners] engagement 扫描范围
 * @param {string | null} [viewerEntityHash] 观看者实体（用于 poll 自选投影）
 * @returns {Promise<object>} feed 条目构建上下文
 */
export async function createFeedItemBuildContext(username, owners, viewerEntityHash = null) {
	const engagement = await buildEngagementIndex(username, owners)
	const viewerLiked = await buildViewerLikedSet(username, viewerEntityHash)
	const viewerDisliked = await buildViewerDislikedSet(username, viewerEntityHash)
	const authorProfile = createAuthorProfileLoader(username)
	const engagementForPost = createEngagementForPost(engagement, viewerLiked, viewerDisliked)
	let viewerPollChoices = null
	if (viewerEntityHash) {
		const view = await getTimelineMaterialized(username, viewerEntityHash)
		viewerPollChoices = view
	}
	const viewerContext = await loadViewerContext(username, viewerEntityHash)
	/** @type {Map<string, object>} */
	const albumViewCache = new Map()
	/**
	 * @param {string} authorEntityHash 作者
	 * @param {string} postId 帖
	 * @returns {{ albumId: string, name: string }[]} 可见相册
	 */
	function albumsForPost(authorEntityHash, postId) {
		const owner = String(authorEntityHash).toLowerCase()
		const view = albumViewCache.get(owner)
		if (!view) 
			// 同步缓存：物化视图通常已在内存；首次 miss 时用空（异步预热由调用方保证）
			return []
		
		return albumsForPostFromView(view, owner, postId, viewerContext)
	}
	/**
	 * @param {string} authorEntityHash 作者
	 * @returns {Promise<void>}
	 */
	async function warmAlbumView(authorEntityHash) {
		const owner = String(authorEntityHash).toLowerCase()
		if (albumViewCache.has(owner)) return
		albumViewCache.set(owner, await getTimelineMaterialized(username, owner))
	}
	return {
		authorProfile,
		engagementForPost,
		engagement,
		viewerLiked,
		viewerDisliked,
		viewerPollChoices,
		viewerEntityHash,
		albumsForPost,
		warmAlbumView,
		albumViewCache,
	}
}

/**
 * @param {string} username 用户
 * @param {string} [viewerEntityHash] 观看实体；缺省为 operator
 * @returns {AsyncGenerator<string>} 可见时间线 owner
 */
export async function* iterateVisibleTimelineOwners(username, viewerEntityHash) {
	for (const entityHash of await listFollowedTimelineOwners(username, viewerEntityHash)) {
		if (!isEntityHash128(entityHash)) continue
		if (isEntityHashBlocked(entityHash)) continue
		if (shouldHideAuthorByReputation(entityHash, pickNodeScore)) continue
		yield entityHash
	}
}

/**
 * @param {string} username 用户
 * @param {Awaited<ReturnType<import('./home.mjs').loadViewerContext>>} viewerContext 观看者上下文
 * @returns {AsyncGenerator<{ entityHash: string, post: object, enriched: object }>} 可见帖子
 */
export async function* iterateVisiblePosts(username, viewerContext) {
	for await (const entityHash of iterateVisibleTimelineOwners(username, viewerContext?.viewerEntityHash)) {
		const view = await getTimelineMaterialized(username, entityHash)
		if (!view.posts?.length) continue
		for (const post of view.posts) {
			const enriched = { ...post, entityHash }
			if (!canViewPost(enriched, viewerContext)) continue
			yield { entityHash, post, enriched }
		}
	}
}
