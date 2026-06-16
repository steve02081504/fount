import { resolveOperatorEntityHash } from '../../../../../scripts/p2p/entity/replica.mjs'

import { getEntityProfile } from './feed.mjs'
import { listKnownTimelineOwners } from './feedHelpers.mjs'
import { extractMentionEntityHashes } from './lib/mentions.mjs'
import { getTimelineMaterialized } from './timeline/materialize.mjs'

/**
 * 构建观看者的 Social 通知列表。
 * @param {string} username 用户
 * @param {number} [limit=30] 条数上限
 * @returns {Promise<{ notifications: object[], viewerEntityHash: string | null }>} 通知列表
 */
export async function buildNotifications(username, limit = 30) {
	const viewerEntityHash = resolveOperatorEntityHash(username)?.toLowerCase() || null
	if (!viewerEntityHash) return { notifications: [], viewerEntityHash: null }

	/** @type {Map<string, string>} */
	const authorNameCache = new Map()

	/**
	 * 解析通知来源 entity 的展示名（带缓存）。
	 * @param {string} entityHash 通知来源
	 * @returns {Promise<string>} 展示名
	 */
	async function authorName(entityHash) {
		const normalizedEntityHash = entityHash.toLowerCase()
		if (authorNameCache.has(normalizedEntityHash)) return authorNameCache.get(normalizedEntityHash)
		const profile = await getEntityProfile(username, normalizedEntityHash)
		const displayName = profile?.name
			|| `${normalizedEntityHash.slice(0, 8)}…${normalizedEntityHash.slice(-4)}`
		authorNameCache.set(normalizedEntityHash, displayName)
		return displayName
	}

	/** @type {object[]} */
	const notifications = []

	for (const owner of await listKnownTimelineOwners(username)) {
		const view = await getTimelineMaterialized(username, owner)
		for (const post of view.posts) {
			const at = Number(post.hlc.wall)
			const snippet = (post.content?.text || '').slice(0, 120)
			const replyTo = post.content?.replyTo
			if (replyTo?.entityHash?.toLowerCase() === viewerEntityHash)
				notifications.push({
					type: 'reply',
					entityHash: owner,
					authorName: await authorName(owner),
					postId: post.id,
					targetPostId: replyTo.postId,
					at,
					snippet,
				})

			if (owner !== viewerEntityHash && extractMentionEntityHashes(post.content?.text || '').includes(viewerEntityHash))
				notifications.push({
					type: 'mention',
					entityHash: owner,
					authorName: await authorName(owner),
					postId: post.id,
					at,
					snippet,
				})
		}
		for (const like of view.likes) {
			if ((like.content?.targetEntityHash || '').toLowerCase() !== viewerEntityHash) continue
			notifications.push({
				type: 'like',
				entityHash: owner,
				authorName: await authorName(owner),
				targetPostId: like.content?.targetPostId,
				at: Number(like.hlc.wall),
			})
		}
		for (const repost of view.reposts) {
			if ((repost.content?.targetEntityHash || '').toLowerCase() !== viewerEntityHash) continue
			notifications.push({
				type: 'repost',
				entityHash: owner,
				authorName: await authorName(owner),
				targetPostId: repost.content?.targetPostId,
				at: Number(repost.hlc.wall),
				snippet: String(repost.content?.comment || '').slice(0, 120),
			})
		}
		if (owner !== viewerEntityHash && view.following.includes(viewerEntityHash)) {
			const at = (view.followEvents || []).reduce((max, follow) => {
				if (String(follow.content?.targetEntityHash || '').toLowerCase() !== viewerEntityHash) return max
				return Math.max(max, Number(follow.hlc.wall))
			}, 0)
			notifications.push({
				type: 'follow',
				entityHash: owner,
				authorName: await authorName(owner),
				at,
			})
		}
	}

	const deduped = []
	const seen = new Set()
	for (const row of notifications.sort((left, right) => right.at - left.at)) {
		const key = `${row.type}:${row.entityHash}:${row.postId || ''}:${row.targetPostId || ''}:${row.at}`
		if (seen.has(key)) continue
		seen.add(key)
		deduped.push(row)
		if (deduped.length >= limit) break
	}

	return { notifications: deduped, viewerEntityHash }
}
