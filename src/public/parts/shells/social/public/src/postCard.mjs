import { wrapContentWarningHtml } from '/scripts/features/contentReveal/index.mjs'
import { renderTemplate } from '../../../../scripts/features/template.mjs'
import { renderGroupRefBlockHtml } from '../shared/groupRef.mjs'

import { formatActionKey } from './lib/actionKey.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { entityHandle } from './lib/display.mjs'
import { formatSocialProfileHref } from '/parts/shells:chat/shared/socialRunUri.mjs'
import { renderPollHtml } from './lib/pollUi.mjs'
import { renderMediaHtml } from './mediaRender.mjs'

/**
 * @param {object} liveRef 直播引用
 * @param {(key: string, params?: object) => string} geti18n i18n
 * @returns {string} HTML
 */
function renderLiveRefHtml(liveRef, geti18n) {
	const entityHash = String(liveRef.entityHash || '').toLowerCase()
	const liveId = String(liveRef.liveId || '').toLowerCase()
	const ended = liveRef.status === 'ended'
	const href = `#live:${entityHash}:${liveId}`
	if (ended) {
		const viewers = Number(liveRef.totalViewers) || 0
		const likes = Number(liveRef.totalLikes) || 0
		const durationMs = Number(liveRef.duration) || 0
		const secs = Math.max(0, Math.round(durationMs / 1000))
		const mm = String(Math.floor(secs / 60)).padStart(2, '0')
		const ss = String(secs % 60).padStart(2, '0')
		return `<a class="live-ref-card live-ref-card--ended" href="${escapeHtml(href)}">
			<span class="live-ref-badge">${escapeHtml(geti18n('social.live.postEnded'))}</span>
			<span class="live-ref-avatar" data-avatar-for="${escapeHtml(entityHash)}"></span>
			<span class="live-ref-stats">${escapeHtml(geti18n('social.live.postEndedStats', { viewers, likes, duration: `${mm}:${ss}` }))}</span>
		</a>`
	}
	return `<a class="live-ref-card" href="${escapeHtml(href)}">
		<span class="live-ref-badge">LIVE</span>
		<span class="live-ref-avatar" data-avatar-for="${escapeHtml(entityHash)}"></span>
		<span class="live-ref-cta">${escapeHtml(geti18n('social.live.postWatch'))}</span>
	</a>`
}

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
		const sensitiveMedia = item.post?.content?.sensitiveMedia === true
			|| Boolean(contentWarning)
		const text = item.post?.content?.text || (decryptFailed ? decryptFailedLabel : '')
		const contentAuthor = isRepost ? originalAuthor : item.entityHash
		const markdownBody = decryptFailed
			? `<em>${decryptFailedLabel}</em>`
			: await renderMarkdown(text, contentAuthor)
		const mediaHtmlRaw = decryptFailed
			? ''
			: renderMediaHtml(item.post?.content?.mediaRefs, {
				sensitive: sensitiveMedia && !contentWarning,
				warningLabel: geti18n('social.feed.sensitiveMedia'),
				revealLabel: geti18n('social.feed.revealContent'),
			})
		const quoteRef = item.post?.content?.quoteRef
		const quoteHtml = quoteRef && !decryptFailed
			? renderQuoteBlockHtml(geti18n, { ...quoteRef, text: quoteRef.text || '' })
			: ''
		const groupRef = item.post?.content?.groupRef
		const groupRefHtml = groupRef && !decryptFailed
			? renderGroupRefBlockHtml(groupRef)
			: ''
		const pollHtml = item.poll && !decryptFailed
			? renderPollHtml(item.poll, actionKey, geti18n)
			: ''
		const liveRef = item.post?.content?.liveRef
		const liveRefHtml = liveRef && !decryptFailed
			? renderLiveRefHtml(liveRef, geti18n)
			: ''
		let contentBlock = `${pollHtml}${mediaHtmlRaw}${liveRefHtml}<div class="body markdown-body">${markdownBody}</div>`
		if (contentWarning && !decryptFailed)
			contentBlock = wrapContentWarningHtml(contentBlock, {
				warningLabel: contentWarning,
				revealLabel: geti18n('social.feed.revealContent'),
			})

		const viewerEntityHash = getViewerEntityHash()
		const isOwn = viewerEntityHash && item.entityHash === viewerEntityHash && !isRepost
		const itemOwner = String(item.ownerEntityHash || item.authorProfile?.ownerEntityHash || '').trim().toLowerCase()
		const isManagedPost = !isRepost && !isOwn
			&& !!viewerEntityHash
			&& !!itemOwner
			&& itemOwner === String(viewerEntityHash).toLowerCase()
		const canManage = isOwn || isManagedPost
		const canDelete = canManage
		const label = authorLabel(item.entityHash, item.authorProfile)
		const visibilityCode = item.post?.content?.visibility === 'followers' ? 'followers' : 'public'
		const visibilityIcon = visibilityCode === 'followers'
			? `<span class="s-ic s-ic-lock post-visibility-icon" title="${geti18n('social.composer.visibilityFollowers')}" aria-label="${geti18n('social.composer.visibilityFollowers')}"></span>`
			: `<span class="s-ic s-ic-globe post-visibility-icon" title="${geti18n('social.composer.visibilityPublic')}" aria-label="${geti18n('social.composer.visibilityPublic')}"></span>`
		const likedClass = item.viewerLiked ? ' liked' : ''
		const dislikedClass = item.viewerDisliked ? ' disliked' : ''
		const likeLabel = item.viewerLiked
			? geti18n('social.actions.unlike')
			: geti18n('social.actions.like')
		const dislikeLabel = item.viewerDisliked
			? geti18n('social.actions.undislike')
			: geti18n('social.actions.dislike')
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
		const editedBadge = item.post?.edited
			? `<span class="post-edited-badge">${geti18n('social.post.edited')}</span>`
			: ''
		const treatAsOwn = canManage
		const blockButton = treatAsOwn
			? ''
			: `<button type="button" class="danger-item" data-block="${item.entityHash}"><span class="s-ic s-ic-block" aria-hidden="true"></span><span data-i18n="social.actions.block"></span></button>`
		const hideButton = treatAsOwn
			? ''
			: `<button type="button" data-hide="${item.entityHash}"><span class="s-ic s-ic-hide" aria-hidden="true"></span><span data-i18n="social.actions.hide"></span></button>`
		const muteButton = treatAsOwn
			? ''
			: `<button type="button" data-mute="${item.entityHash}"><span class="s-ic s-ic-mute" aria-hidden="true"></span><span data-i18n="social.actions.mute"></span></button>`
		const deleteButton = canDelete
			? `<button type="button" class="danger-item" data-delete="${item.postId}" data-delete-entity="${item.entityHash}"><span class="s-ic s-ic-delete" aria-hidden="true"></span><span data-i18n="social.actions.delete"></span></button>`
			: ''
		const editButton = canManage
			? `<button type="button" data-edit="${actionKey}"><span class="s-ic s-ic-edit" aria-hidden="true"></span><span data-i18n="social.actions.edit"></span></button>`
			: ''
		const editHistoryButton = canManage && item.post?.revisions?.length
			? `<button type="button" data-edit-history="${actionKey}"><span data-i18n="social.post.editHistory"></span></button>`
			: ''

		const topNote = item.communityNote?.topNote
		const communityNoteHtml = topNote
			? `<div class="community-note" data-note-for="${actionKey}">
				<div class="community-note-label">${escapeHtml(geti18n('social.notes.label'))}</div>
				<p class="community-note-text">${escapeHtml(topNote.text || '')}</p>
				<div class="community-note-actions">
					<button type="button" class="btn btn-ghost btn-xs" data-note-vote="${actionKey}" data-note-id="${escapeHtml(topNote.noteEventId)}" data-helpful="1">${escapeHtml(geti18n('social.notes.helpful'))} (${topNote.helpfulCount || 0})</button>
					<button type="button" class="btn btn-ghost btn-xs" data-note-vote="${actionKey}" data-note-id="${escapeHtml(topNote.noteEventId)}" data-helpful="0">${escapeHtml(geti18n('social.notes.unhelpful'))} (${topNote.unhelpfulCount || 0})</button>
					<button type="button" class="btn btn-ghost btn-xs" data-note-more="${actionKey}">${escapeHtml(geti18n('social.notes.more', { n: item.communityNote.noteCount || 1 }))}</button>
				</div>
			</div>`
			: item.communityNote?.noteCount
				? `<div class="community-note community-note-collapsed">
					<button type="button" class="btn btn-ghost btn-xs" data-note-more="${actionKey}">${escapeHtml(geti18n('social.notes.more', { n: item.communityNote.noteCount }))}</button>
				</div>`
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
			editedBadge,
			visibilityIcon,
			moreLabel: geti18n('social.actions.more'),
			replyLabel: geti18n('social.actions.replies'),
			repostLabel: geti18n('social.actions.repost'),
			saveLabel: geti18n('social.actions.save'),
			shareLabel: geti18n('social.actions.share'),
			quoteHtml,
			groupRefHtml,
			contentBlock,
			communityNoteHtml,
			likedClass,
			dislikedClass,
			actionKey,
			likedFlag: item.viewerLiked ? '1' : '0',
			dislikedFlag: item.viewerDisliked ? '1' : '0',
			likeLabel,
			dislikeLabel,
			likeCount: item.likeCount || 0,
			dislikeCount: item.dislikeCount || 0,
			repostCount: item.repostCount || 0,
			replyCount: item.replyCount || 0,
			entityHash: item.entityHash,
			blockButton,
			hideButton,
			muteButton,
			editButton,
			editHistoryButton,
			deleteButton,
		})
		return /** @type {HTMLElement} */ card
	}
}
