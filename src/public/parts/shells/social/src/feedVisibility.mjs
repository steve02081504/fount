import { isAuthorFilteredByPersonalSets } from 'npm:@steve02081504/fount-p2p/node/personal_block'

import { postMatchesMutedKeywords } from './lib/contentFilter.mjs'
import { canViewByVisibility } from './lib/visibilitySpec.mjs'

/**
 * 根据可见性与个人拉黑/隐藏/关注关系判断帖子是否对观看者可见。
 * @param {object} post 帖子
 * @param {object} viewerContext loadViewerContext 结果
 * @returns {boolean} 是否可见
 */
export function canViewPost(post, viewerContext) {
	const authorEntity = String(post.entityHash || '').toLowerCase()
	if (isAuthorFilteredByPersonalSets(viewerContext.personalFilter, authorEntity))
		return false
	if (postMatchesMutedKeywords(post, viewerContext.mutedKeywords))
		return false
	return canViewByVisibility(post.content, viewerContext, authorEntity)
}

/**
 * 相册可见性（与帖同核心，无关键词过滤）。
 * @param {object} album 相册物化行（含 visibility 字段）
 * @param {string} ownerEntityHash owner
 * @param {object} viewerContext 观看者上下文
 * @returns {boolean} 是否可见
 */
export function canViewAlbum(album, ownerEntityHash, viewerContext) {
	return canViewByVisibility(album, viewerContext, ownerEntityHash)
}
