import { readFile } from 'node:fs/promises'

import { isEntityHashBlocked } from '../../../../../../scripts/p2p/denylist.mjs'
import { isEntityHash128 } from '../../../../../../scripts/p2p/entity_id.mjs'
import { pickNodeScore } from '../../../../../../scripts/p2p/reputation_store.mjs'
import { shouldHideAuthorByReputation } from '../../../../../../scripts/p2p/reputation_social.mjs'
import { getUserDictionary } from '../../../../../../server/auth.mjs'
import { listKnownTimelineOwners, loadViewerContext } from '../feed/helpers.mjs'
import { canViewPost } from '../feedVisibility.mjs'
import { extractHashtagsFromText } from '../lib/hashtags.mjs'
import { getTimelineMaterialized } from '../timeline/materialize.mjs'

/**
 * 判断本地是否持有可读时间线 events.jsonl。
 * @param {string} username 用户
 * @param {string} entityHash 时间线 owner
 * @returns {Promise<boolean>} 本地是否持有时间线
 */
async function timelineExists(username, entityHash) {
	try {
		await readFile(`${getUserDictionary(username)}/shells/social/timelines/${entityHash}/events.jsonl`, 'utf8')
		return true
	}
	catch {
		return false
	}
}

/**
 * 从观看者可见帖子统计热门话题。
 * @param {string} username 用户
 * @param {object} [options] 选项
 * @param {number} [options.limit=12] 返回条数
 * @returns {Promise<{ tags: { tag: string, count: number }[] }>} 热门话题
 */
export async function buildTrendingHashtags(username, options = {}) {
	const limit = Math.min(Math.max(Number(options.limit) || 12, 1), 32)
	const viewerContext = await loadViewerContext(username)
	/** @type {Map<string, number>} */
	const counts = new Map()

	for (const entityHash of await listKnownTimelineOwners(username)) {
		if (!isEntityHash128(entityHash)) continue
		if (isEntityHashBlocked(entityHash)) continue
		if (shouldHideAuthorByReputation(entityHash, pickNodeScore)) continue
		if (!await timelineExists(username, entityHash)) continue
		const view = await getTimelineMaterialized(username, entityHash)
		for (const post of view.posts) {
			const enriched = { ...post, entityHash }
			if (!canViewPost(enriched, viewerContext))
				continue
			if (!post.content?.text) continue
			for (const tag of extractHashtagsFromText(post.content?.text))
				counts.set(tag, (counts.get(tag) || 0) + 1)
		}
	}

	const tags = [...counts.entries()]
		.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
		.slice(0, limit)
		.map(([tag, count]) => ({ tag, count }))

	return { tags }
}
