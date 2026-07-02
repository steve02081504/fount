
import { resolveOperatorEntityHashForUser as resolveOperatorEntityHash } from '../../../../../server/p2p_server/operator_identity.mjs'

/**
 * @param {object} row 通知条目
 * @returns {string} 分页游标
 */
export function notificationCursor(row) {
	return `${row.at}:${row.actorEntityHash}:${row.type}:${row.postId ?? ''}:${row.targetPostId ?? ''}`
}

/**
 * @param {string} type 通知类型
 * @param {string} actorEntityHash 动作来源
 * @param {number} at 时间戳
 * @param {string | null | undefined} postId 相关帖 id
 * @param {string | null | undefined} targetPostId 目标帖 id
 * @returns {object} 规范化通知条目
 */
function notificationRow(type, actorEntityHash, at, postId, targetPostId) {
	return {
		type,
		actorEntityHash: actorEntityHash.toLowerCase(),
		postId: postId ?? null,
		targetPostId: targetPostId ?? null,
		at,
	}
}

/**
 * 构建观看者的 Social 通知列表。
 * @param {string} username 用户
 * @param {object} [options] 分页选项
 * @param {number} [options.limit=30] 条数上限
 * @param {string} [options.cursor] 分页游标
 * @returns {Promise<{ notifications: object[], nextCursor: string | null, viewerEntityHash: string | null }>} 通知列表
 */
export async function buildNotifications(username, options = {}) {
	const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100)
	const cursor = options.cursor ? String(options.cursor) : null
	const viewerEntityHash = (await resolveOperatorEntityHash(username))?.toLowerCase() || null
	if (!viewerEntityHash)
		return { notifications: [], nextCursor: null, viewerEntityHash: null }

	const { getEntityProfile } = await import('./feed.mjs')
	const { listKnownTimelineOwners } = await import('./feedHelpers.mjs')
	const { extractMentionEntityHashes } = await import('./lib/mentions.mjs')
	const { getTimelineMaterialized } = await import('./timeline/materialize.mjs')

	/** @type {object[]} */
	const notifications = []

	for (const owner of await listKnownTimelineOwners(username)) {
		const view = await getTimelineMaterialized(username, owner)
		for (const post of view.posts) {
			const at = Number(post.hlc.wall)
			const replyTo = post.content?.replyTo
			if (replyTo?.entityHash?.toLowerCase() === viewerEntityHash)
				notifications.push(notificationRow('reply', owner, at, post.id, replyTo.postId))

			if (owner !== viewerEntityHash && extractMentionEntityHashes(post.content?.text || '').includes(viewerEntityHash))
				notifications.push(notificationRow('mention', owner, at, post.id, null))
		}
		for (const like of view.likes) {
			if ((like.content?.targetEntityHash || '').toLowerCase() !== viewerEntityHash) continue
			notifications.push(notificationRow(
				'like',
				owner,
				Number(like.hlc.wall),
				null,
				like.content?.targetPostId ?? null,
			))
		}
		for (const repost of view.reposts) {
			if ((repost.content?.targetEntityHash || '').toLowerCase() !== viewerEntityHash) continue
			notifications.push(notificationRow(
				'repost',
				owner,
				Number(repost.hlc.wall),
				null,
				repost.content?.targetPostId ?? null,
			))
		}
		if (owner !== viewerEntityHash && view.following.includes(viewerEntityHash)) {
			const at = (view.followEvents || []).reduce((max, follow) => {
				if (String(follow.content?.targetEntityHash || '').toLowerCase() !== viewerEntityHash) return max
				return Math.max(max, Number(follow.hlc.wall))
			}, 0)
			notifications.push(notificationRow('follow', owner, at, null, null))
		}
	}

	const deduped = []
	const seen = new Set()
	for (const row of notifications.sort((left, right) => right.at - left.at)) {
		const key = notificationCursor(row)
		if (seen.has(key)) continue
		seen.add(key)
		deduped.push(row)
	}

	let startIndex = 0
	if (cursor) {
		startIndex = deduped.findIndex(row => notificationCursor(row) === cursor) + 1
		if (startIndex <= 0) startIndex = deduped.length
	}
	const page = deduped.slice(startIndex, startIndex + limit)
	const nextCursor = page.length === limit && startIndex + limit < deduped.length
		? notificationCursor(page[page.length - 1])
		: null

	return { notifications: page, nextCursor, viewerEntityHash }
}
