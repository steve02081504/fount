import { renderTemplate } from '../../../../../pages/scripts/template.mjs'

import { renderGroupRefBlockHtml } from './lib/groupRef.mjs'
import { formatSocialProfileHref } from './lib/runUri.mjs'
import { renderMediaHtml } from './media.mjs'

/**
 * 创建 feed 帖子卡片构建函数（闭包注入依赖）。
 * @param {object} deps 依赖
 * @param {() => string | null} deps.getViewerEntityHash 当前观看者
 * @param {(key: string, params?: object) => string} deps.geti18n i18n 函数
 * @param {Function} deps.authorLabel 作者展示名
 * @param {Function} deps.renderAvatarHtml 头像 HTML
 * @param {Function} deps.formatTime 时间格式化
 * @param {Function} deps.renderMarkdown Markdown 渲染
 * @param {Function} deps.renderQuoteBlockHtml 引用块 HTML
 * @returns {(item: object) => Promise<HTMLElement>} 构建帖子卡片
 */
export function createPostCardBuilder(deps) {
	const {
		getViewerEntityHash,
		geti18n,
		authorLabel,
		renderAvatarHtml,
		formatTime,
		renderMarkdown,
		renderQuoteBlockHtml,
	} = deps

	/**
	 * 将单条 feed 条目渲染为帖子卡片 DOM。
	 * @param {object} item feed 条目
	 * @returns {Promise<HTMLElement>} 帖子卡片
	 */
	return async function buildPostCard(item) {
		const isRepost = item.kind === 'repost'
		const actionEntity = item.targetEntityHash || item.entityHash
		const actionPostId = item.targetPostId || item.postId
		const actionKey = `${actionEntity}:${actionPostId}`
		const originalAuthor = isRepost ? item.targetEntityHash : item.entityHash
		const protectedLabel = geti18n('social.profile.protectedPost')
		const text = item.post?.content?.text || (item.post?.content?.protected ? protectedLabel : '')
		const contentAuthor = isRepost ? originalAuthor : item.entityHash
		const html = item.post?.content?.protected
			? `<em>${protectedLabel}</em>`
			: await renderMarkdown(text, contentAuthor)
		const viewerEntityHash = getViewerEntityHash()
		const isOwn = viewerEntityHash && item.entityHash === viewerEntityHash && !isRepost
		const label = authorLabel(item.entityHash, item.authorProfile)
		const visibility = item.post?.content?.visibility === 'followers'
			? geti18n('social.composer.visibilityFollowers')
			: geti18n('social.composer.visibilityPublic')
		const mediaHtml = item.post?.content?.protected ? '' : renderMediaHtml(item.post?.content?.mediaRefs)
		const quoteRef = item.post?.content?.quoteRef
		const quoteHtml = quoteRef && !item.post?.content?.protected
			? renderQuoteBlockHtml(geti18n, { ...quoteRef, text: quoteRef.text || '' })
			: ''
		const groupRef = item.post?.content?.groupRef
		const groupRefHtml = groupRef && !item.post?.content?.protected
			? renderGroupRefBlockHtml(groupRef)
			: ''
		const likedClass = item.viewerLiked ? ' liked' : ''
		const likeLabel = item.viewerLiked
			? geti18n('social.actions.unlike')
			: geti18n('social.actions.like')
		const repostBanner = isRepost
			? `<div class="repost-banner">${geti18n('social.feed.repostedBy', { author: label })}</div>`
			: ''
		const repostCommentHtml = isRepost && item.repostComment
			? `<div class="body markdown-body repost-comment">${await renderMarkdown(item.repostComment, item.entityHash)}</div>`
			: ''
		const embeddedWrapStart = isRepost ? '<div class="embedded-post">' : ''
		const embeddedWrapEnd = isRepost ? '</div>' : ''
		const headerAuthor = isRepost
			? authorLabel(originalAuthor)
			: label
		const headerLink = isRepost
			? formatSocialProfileHref(originalAuthor)
			: formatSocialProfileHref(item.entityHash)
		const headerAvatarEntity = isRepost ? originalAuthor : item.entityHash
		const headerAvatarProfile = isRepost ? null : item.authorProfile
		const postMeta = `${formatTime(geti18n, item.post?.hlc?.wall)} · ${visibility}`
		const blockBtn = isOwn
			? ''
			: `<button type="button" data-block="${item.entityHash}"><span data-i18n="social.actions.block"></span></button>`
		const deleteBtn = isOwn
			? `<button type="button" data-delete="${item.postId}"><span data-i18n="social.actions.delete"></span></button>`
			: ''

		const card = await renderTemplate('post_card', {
			postId: item.postId,
			postTextEncoded: encodeURIComponent(text),
			repostBanner,
			repostCommentHtml,
			embeddedWrapStart,
			embeddedWrapEnd,
			headerAvatarHtml: renderAvatarHtml(headerAvatarEntity, headerAvatarProfile),
			headerAuthor,
			headerLink,
			postMeta,
			quoteHtml,
			groupRefHtml,
			mediaHtml,
			bodyHtml: html,
			likedClass,
			actionKey,
			likedFlag: item.viewerLiked ? '1' : '0',
			likeLabel,
			likeCount: item.likeCount || 0,
			repostCount: item.repostCount || 0,
			replyCount: item.replyCount || 0,
			entityHash: item.entityHash,
			blockBtn,
			deleteBtn,
		})
		return /** @type {HTMLElement} */ card
	}
}
