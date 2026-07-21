import { renderTemplateAsHtmlString } from '/scripts/features/template.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'

/**
 * 从 feed item / reply 组装互动栏模板数据。
 * @param {object} item feed 条目（含 engagement 字段）
 * @param {string} actionKey entityHash:postId
 * @returns {object} engagement_bar 模板变量
 */
export function engagementBarTemplateData(item, actionKey) {
	const liked = Boolean(item.viewerLiked)
	const disliked = Boolean(item.viewerDisliked)
	return {
		actionKey,
		likedClass: liked ? ' liked' : '',
		dislikedClass: disliked ? ' disliked' : '',
		likedFlag: liked ? '1' : '0',
		dislikedFlag: disliked ? '1' : '0',
		likeLabel: liked ? geti18n('social.actions.unlike') : geti18n('social.actions.like'),
		dislikeLabel: disliked ? geti18n('social.actions.undislike') : geti18n('social.actions.dislike'),
		replyLabel: geti18n('social.actions.replies'),
		repostLabel: geti18n('social.actions.repost'),
		saveLabel: geti18n('social.actions.save'),
		shareLabel: geti18n('social.actions.share'),
		likeCount: item.likeCount || 0,
		dislikeCount: item.dislikeCount || 0,
		repostCount: item.repostCount || 0,
		replyCount: item.replyCount || 0,
	}
}

/**
 * 渲染统一互动栏（回复 / 转发 / 赞 / 踩 / 收藏 / 分享 + 转发面板）。
 * @param {object} item feed 条目
 * @param {string} actionKey entityHash:postId
 * @returns {Promise<string>} HTML
 */
export function renderEngagementBarHtml(item, actionKey) {
	return renderTemplateAsHtmlString('engagement_bar', engagementBarTemplateData(item, actionKey))
}
