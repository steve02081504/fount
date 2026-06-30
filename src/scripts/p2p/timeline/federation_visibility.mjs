/**
 * Social 时间线联邦 pull 出站可见性纯逻辑。
 */

/** 联邦 pull 永不外泄的类型 */
export const FEDERATION_PRIVATE_EVENT_TYPES = new Set([
	'follow',
	'unfollow',
	'follow_approve',
	'like',
	'unlike',
	'file_share',
])

/**
 * @param {object} event 时间线事件
 * @param {string} ownerEntityHash owner
 * @param {object} requesterContext 请求者上下文
 * @param {(post: object, requesterEntityHash: string | null, blocked: Set<string>, following: Set<string>) => boolean} canViewPost 帖子可见性
 * @returns {boolean} 是否可联邦导出
 */
export function isTimelineEventVisibleForFederation(event, ownerEntityHash, requesterContext, canViewPost) {
	const type = event.type
	if (FEDERATION_PRIVATE_EVENT_TYPES.has(type)) return false
	if (requesterContext.isOwner) return true

	if (type === 'social_meta') return !requesterContext.isProtected

	if (type === 'post' || type === 'repost')
		return canViewPost(
			{ entityHash: ownerEntityHash, content: event.content },
			requesterContext.requesterEntityHash,
			new Set(),
			new Set(requesterContext.followsOwner ? [ownerEntityHash] : []),
		)

	if (type === 'post_delete') return true

	return false
}

/**
 * @param {object[]} events 原始事件
 * @param {string} ownerEntityHash owner
 * @param {object} requesterContext 请求者上下文
 * @param {(post: object, requesterEntityHash: string | null, blocked: Set<string>, following: Set<string>) => boolean} canViewPost 帖子可见性
 * @returns {object[]} 过滤后的事件
 */
export function filterTimelineEventsForFederation(events, ownerEntityHash, requesterContext, canViewPost) {
	const owner = String(ownerEntityHash).toLowerCase()
	return events.filter(event => isTimelineEventVisibleForFederation(event, owner, requesterContext, canViewPost))
}
