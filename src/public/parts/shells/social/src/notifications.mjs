
import { resolveOperatorEntityHashForUser as resolveOperatorEntityHash } from '../../../../../server/p2p_server/operator_identity.mjs'

import { readInboxNotifications, notificationCursor, normalizeNotificationRow } from './inbox.mjs'

/**
 *
 */
export { notificationCursor }

/**
 * 构建观看者的 Social 通知列表（inbox 持久层）。
 * @param {string} username 用户
 * @param {object} [options] 分页选项
 * @param {number} [options.limit=30] 条数上限
 * @param {string} [options.cursor] 分页游标
 * @param {string[] | null} [options.types] 类型过滤
 * @returns {Promise<{ notifications: object[], nextCursor: string | null, unreadCount: number, viewerEntityHash: string | null }>} 通知列表
 */
export async function buildNotifications(username, options = {}) {
	const viewerEntityHash = (await resolveOperatorEntityHash(username))?.toLowerCase() || null
	if (!viewerEntityHash)
		return { notifications: [], nextCursor: null, unreadCount: 0, viewerEntityHash: null }
	const page = await readInboxNotifications(username, viewerEntityHash, options)
	return { ...page, viewerEntityHash }
}

/**
 * 旧版全量扫描通知（仅 rebuildInbox 使用）。
 * @param {string} username 用户
 * @param {object} [options] 分页选项
 * @returns {Promise<{ notifications: object[], nextCursor: string | null, viewerEntityHash: string | null }>} 分页通知与观看者实体
 */
export async function buildNotificationsLegacy(username, options = {}) {
	const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100)
	const cursor = options.cursor ? String(options.cursor) : null
	const viewerEntityHash = (await resolveOperatorEntityHash(username))?.toLowerCase() || null
	if (!viewerEntityHash)
		return { notifications: [], nextCursor: null, viewerEntityHash: null }

	const { listFollowedTimelineOwners } = await import('./feed/helpers.mjs')
	const { extractMentionEntityHashes } = await import('../../../../../scripts/p2p/mentions.mjs')
	const { getTimelineMaterialized } = await import('./timeline/materialize.mjs')

	/** @type {object[]} */
	const notifications = []

	for (const owner of await listFollowedTimelineOwners(username)) {
		const view = await getTimelineMaterialized(username, owner)
		for (const post of view.posts) {
			const at = Number(post.hlc.wall)
			const replyTo = post.content?.replyTo
			if (replyTo?.entityHash?.toLowerCase() === viewerEntityHash)
				notifications.push(normalizeNotificationRow('reply', owner, at, post.id, replyTo.postId))

			if (owner !== viewerEntityHash && extractMentionEntityHashes(post.content?.text || '').includes(viewerEntityHash))
				notifications.push(normalizeNotificationRow('mention', owner, at, post.id, null))
		}
		for (const like of view.likes) {
			if ((like.content?.targetEntityHash || '').toLowerCase() !== viewerEntityHash) continue
			notifications.push(normalizeNotificationRow(
				'like',
				owner,
				Number(like.hlc.wall),
				null,
				like.content?.targetPostId ?? null,
			))
		}
		for (const repost of view.reposts) {
			if ((repost.content?.targetEntityHash || '').toLowerCase() !== viewerEntityHash) continue
			notifications.push(normalizeNotificationRow(
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
			notifications.push(normalizeNotificationRow('follow', owner, at, null, null))
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
