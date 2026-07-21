/**
 * Social 时间线联邦 pull 出站可见性纯逻辑。
 */

import { canViewByVisibility } from '../lib/visibilitySpec.mjs'

/** 联邦 pull 永不外泄的类型（反应按 owner.publishReactions 另过滤） */
export const FEDERATION_PRIVATE_EVENT_TYPES = new Set([
	'follow',
	'unfollow',
	'follow_approve',
	'file_share',
])

/** 受 publishReactions 控制的反应事件 */
export const FEDERATION_REACTION_EVENT_TYPES = new Set([
	'like',
	'unlike',
	'dislike',
	'undislike',
])

/** 相册相关事件 */
export const FEDERATION_ALBUM_EVENT_TYPES = new Set([
	'album_create',
	'album_update',
	'album_delete',
	'album_post_add',
	'album_post_remove',
])

/**
 * @param {object} event 时间线事件
 * @param {string} ownerEntityHash owner
 * @param {object} requesterContext 请求者上下文
 * @param {(post: object, requesterEntityHash: string | null, blocked: Set<string>, following: Set<string>, followSince?: Map<string, number>) => boolean} canViewPost 帖子可见性
 * @returns {boolean} 是否可联邦导出
 */
export function isTimelineEventVisibleForFederation(event, ownerEntityHash, requesterContext, canViewPost) {
	const type = event.type
	if (FEDERATION_PRIVATE_EVENT_TYPES.has(type)) return false
	if (FEDERATION_REACTION_EVENT_TYPES.has(type))
		return requesterContext.publishReactions !== false
	if (requesterContext.isOwner) return true

	if (type === 'social_meta') return !requesterContext.hideFromDiscovery

	if (type === 'post' || type === 'repost')
		return canViewPost(
			{ entityHash: ownerEntityHash, content: event.content },
			requesterContext.requesterEntityHash,
			new Set(),
			new Set(requesterContext.followsOwner ? [ownerEntityHash] : []),
			requesterContext.followSince || new Map(),
		)

	if (type === 'post_edit' || type === 'post_delete' || type === 'post_visibility_set') return true

	if (FEDERATION_ALBUM_EVENT_TYPES.has(type)) {
		const albumId = String(event.content?.albumId || '').trim()
		const album = requesterContext.albums?.[albumId]
		if (type === 'album_delete') return true
		if (!album && (type === 'album_create' || type === 'album_update'))
			return canViewByVisibility(event.content, {
				viewerEntityHash: requesterContext.requesterEntityHash,
				following: new Set(requesterContext.followsOwner ? [ownerEntityHash] : []),
				followSince: requesterContext.followSince || new Map(),
				at: Date.now(),
			}, ownerEntityHash)
		if (!album) return false
		return canViewByVisibility(album, {
			viewerEntityHash: requesterContext.requesterEntityHash,
			following: new Set(requesterContext.followsOwner ? [ownerEntityHash] : []),
			followSince: requesterContext.followSince || new Map(),
			at: Date.now(),
		}, ownerEntityHash)
	}

	if (type === 'poll_vote') {
		if (requesterContext.isOwner) return true
		const target = String(event.content?.targetEntityHash || '').toLowerCase()
		return target === String(requesterContext.requesterEntityHash || '').toLowerCase()
	}

	if (type === 'tag_name')
		return requesterContext.publishPreferences !== false

	return false
}

/**
 * @param {object[]} events 原始事件
 * @param {string} ownerEntityHash owner
 * @param {object} requesterContext 请求者上下文
 * @param {(post: object, requesterEntityHash: string | null, blocked: Set<string>, following: Set<string>, followSince?: Map<string, number>) => boolean} canViewPost 帖子可见性
 * @returns {object[]} 过滤后的事件
 */
export function filterTimelineEventsForFederation(events, ownerEntityHash, requesterContext, canViewPost) {
	const owner = String(ownerEntityHash).toLowerCase()
	return events.filter(event => isTimelineEventVisibleForFederation(event, owner, requesterContext, canViewPost))
}
