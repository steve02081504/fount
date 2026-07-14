import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isEntityHashBlocked } from 'npm:@steve02081504/fount-p2p/node/denylist'
import { pickNodeScore } from 'npm:@steve02081504/fount-p2p/node/reputation_store'

import { shouldHideAuthorByReputation } from '../federation/reputation_social.mjs'
import {
	buildEngagementIndex,
	buildViewerLikedSet,
} from '../feed.mjs'
import { canViewPost } from '../feedVisibility.mjs'
import { listFollowedTimelineOwners } from '../following.mjs'
import { createAuthorProfileLoader } from '../lib/authorProfileSummary.mjs'
import { getTimelineMaterialized } from '../timeline/materialize.mjs'

import { createEngagementForPost } from './buildItem.mjs'

/**
 * @param {string} username 用户
 * @param {Iterable<string>} [owners] engagement 扫描范围
 * @param {string | null} [viewerEntityHash] 观看者实体（用于 poll 自选投影）
 * @returns {Promise<{ authorProfile: ReturnType<typeof createAuthorProfileLoader>, engagementForPost: ReturnType<typeof createEngagementForPost>, engagement: Awaited<ReturnType<typeof buildEngagementIndex>>, viewerLiked: Awaited<ReturnType<typeof buildViewerLikedSet>> }>} feed 条目构建上下文
 */
export async function createFeedItemBuildContext(username, owners, viewerEntityHash = null) {
	const engagement = await buildEngagementIndex(username, owners)
	const viewerLiked = await buildViewerLikedSet(username, viewerEntityHash)
	const authorProfile = createAuthorProfileLoader(username)
	const engagementForPost = createEngagementForPost(engagement, viewerLiked)
	let viewerPollChoices = null
	if (viewerEntityHash) {
		const view = await getTimelineMaterialized(username, viewerEntityHash)
		viewerPollChoices = view
	}
	return { authorProfile, engagementForPost, engagement, viewerLiked, viewerPollChoices }
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
 * @param {Awaited<ReturnType<import('../feed.mjs').loadViewerContext>>} viewerContext 观看者上下文
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
