import { renderTemplate } from '../../../../scripts/features/template.mjs'
import { renderGroupRefBlockHtml } from '../shared/groupRef.mjs'

import { formatActionKey } from './lib/actionKey.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { entityHandle } from './lib/display.mjs'
import { formatSocialProfileHref } from '/parts/shells:chat/shared/socialRunUri.mjs'
import { renderMediaHtml } from './mediaRender.mjs'

/**
 * 创建 feed 帖子卡片构建函数（闭包注入依赖）。
 * @param {object} options 依赖
 * @param {() => string | null} options.getViewerEntityHash 当前观看者
 * @param {(key: string, params?: object) => string} options.geti18n i18n 函数
 * @param {Function} options.authorLabel 作者展示名
 * @param {Function} options.renderAvatarHtml 头像 HTML
 * @param {Function} options.formatTime 时间格式化
 * @param {Function} options.renderMarkdown Markdown 渲染
 * @param {Function} options.renderQuoteBlockHtml 引用块 HTML
 * @returns {(item: object) => Promise<HTMLElement>} 构建帖子卡片
 */
export function createPostCardBuilder({
	getViewerEntityHash,
	geti18n,
	authorLabel,
	renderAvatarHtml,
	formatTime,
	renderMarkdown,
	renderQuoteBlockHtml,
}) {

	/**
	 * 将单条 feed 条目渲染为帖子卡片 DOM。
	 * @param {object} item feed 条目
	 * @returns {Promise<HTMLElement>} 帖子卡片
	 */
	return async function buildPostCard(item) {
		const isRepost = item.kind === 'repost'
		const actionEntity = item.targetEntityHash || item.entityHash
		const actionPostId = item.targetPostId || item.postId
		const actionKey = formatActionKey(actionEntity, actionPostId)
		const originalAuthor = isRepost ? item.targetEntityHash : item.entityHash
		const decryptFailed = item.post?.decryptView?.failed
		const decryptFailedLabel = geti18n('social.feed.decryptFailed')
		const contentWarning = item.post?.content?.contentWarning?.trim()
		const text = item.post?.content?.text || (decryptFailed ? decryptFailedLabel : '')
		const contentAuthor = isRepost ? originalAuthor : item.entityHash
		let bodyHtml = decryptFailed
			? `<em>${decryptFailedLabel}</em>`
			: await renderMarkdown(text, contentAuthor)
		if (contentWarning && !decryptFailed) 
			bodyHtml = `<div class="content-warning-wrap" data-cw-collapsed="1">
				<div class="content-warning-label">${escapeHtml(contentWarning)}</div>
				<button type="button" class="content-warning-reveal" data-i18n="social.feed.revealContent">${geti18n('social.feed.revealContent')}</button>
				<div class="content-warning-body hidden">${bodyHtml}</div>
			</div>`
		
		const viewerEntityHash = getViewerEntityHash()
		const isOwn = viewerEntityHash && item.entityHash === viewerEntityHash && !isRepost
		const label = authorLabel(item.entityHash, item.authorProfile)
		const visibilityCode = item.post?.content?.visibility === 'followers' ? 'followers' : 'public'
		const visibilityIcon = visibilityCode === 'followers'
			? `<span class="s-ic s-ic-lock post-visibility-icon" title="${geti18n('social.composer.visibilityFollowers')}" aria-label="${geti18n('social.composer.visibilityFollowers')}"></span>`
			: `<span class="s-ic s-ic-globe post-visibility-icon" title="${geti18n('social.composer.visibilityPublic')}" aria-label="${geti18n('social.composer.visibilityPublic')}"></span>`
		const mediaHtml = decryptFailed ? '' : renderMediaHtml(item.post?.content?.mediaRefs)
		const quoteRef = item.post?.content?.quoteRef
		const quoteHtml = quoteRef && !decryptFailed
			? renderQuoteBlockHtml(geti18n, { ...quoteRef, text: quoteRef.text || '' })
			: ''
		const groupRef = item.post?.content?.groupRef
		const groupRefHtml = groupRef && !decryptFailed
			? renderGroupRefBlockHtml(groupRef)
			: ''
		const likedClass = item.viewerLiked ? ' liked' : ''
		const likeLabel = item.viewerLiked
			? geti18n('social.actions.unlike')
			: geti18n('social.actions.like')
		const repostBanner = isRepost
			? `<div class="repost-banner"><span class="s-ic s-ic-repost" aria-hidden="true"></span>${geti18n('social.feed.repostedBy', { author: label })}</div>`
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
		const headerHandleEntity = isRepost ? originalAuthor : item.entityHash
		const postTime = formatTime(geti18n, item.post?.hlc?.wall)
		const blockButton = isOwn
			? ''
			: `<button type="button" class="danger-item" data-block="${item.entityHash}"><span class="s-ic s-ic-block" aria-hidden="true"></span><span data-i18n="social.actions.block"></span></button>`
		const hideButton = isOwn
			? ''
			: `<button type="button" data-hide="${item.entityHash}"><span class="s-ic s-ic-hide" aria-hidden="true"></span><span data-i18n="social.actions.hide"></span></button>`
		const muteButton = isOwn
			? ''
			: `<button type="button" data-mute="${item.entityHash}"><span class="s-ic s-ic-mute" aria-hidden="true"></span><span data-i18n="social.actions.mute"></span></button>`
		const reportButton = isOwn
			? ''
			: `<button type="button" data-report="${actionKey}"><span class="s-ic s-ic-report" aria-hidden="true"></span><span data-i18n="social.actions.report"></span></button>`
		const deleteButton = isOwn
			? `<button type="button" class="danger-item" data-delete="${item.postId}"><span class="s-ic s-ic-delete" aria-hidden="true"></span><span data-i18n="social.actions.delete"></span></button>`
			: ''

		const card = await renderTemplate('post_card', {
			postId: item.postId,
			postTextEncoded: encodeURIComponent(text),
			visibilityCode,
			repostBanner,
			repostCommentHtml,
			embeddedWrapStart,
			embeddedWrapEnd,
			headerAvatarHtml: renderAvatarHtml(headerAvatarEntity, headerAvatarProfile),
			headerAuthor,
			headerLink,
			authorHandle: entityHandle(headerHandleEntity),
			postTime,
			visibilityIcon,
			moreLabel: geti18n('social.actions.more'),
			replyLabel: geti18n('social.actions.replies'),
			repostLabel: geti18n('social.actions.repost'),
			saveLabel: geti18n('social.actions.save'),
			quoteHtml,
			groupRefHtml,
			mediaHtml,
			bodyHtml,
			likedClass,
			actionKey,
			likedFlag: item.viewerLiked ? '1' : '0',
			likeLabel,
			likeCount: item.likeCount || 0,
			repostCount: item.repostCount || 0,
			replyCount: item.replyCount || 0,
			entityHash: item.entityHash,
			blockButton,
			hideButton,
			muteButton,
			reportButton,
			deleteButton,
		})
		return /** @type {HTMLElement} */ card
	}
}
