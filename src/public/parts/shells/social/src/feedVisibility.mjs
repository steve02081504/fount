import { isAuthorFilteredByPersonalSets } from '../../../../../scripts/p2p/personal_block.mjs'

/**
 * 根据可见性与个人拉黑/隐藏/关注关系判断帖子是否对观看者可见。
 * @param {object} post 帖子
 * @param {object} viewerContext loadViewerContext 结果
 * @returns {boolean} 是否可见
 */
export function canViewPost(post, viewerContext) {
	const authorEntity = post.entityHash.toLowerCase()
	if (isAuthorFilteredByPersonalSets(viewerContext.personalFilter, authorEntity))
		return false
	const visibility = post.content?.visibility || 'public'
	if (visibility === 'public') return true
	return viewerContext.following.has(authorEntity)
}
