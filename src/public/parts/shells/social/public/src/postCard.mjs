import { wrapContentWarningHtml } from '/scripts/features/contentReveal/index.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'
import { renderTemplate } from '../../../../scripts/features/template.mjs'
import { renderGroupRefBlockHtml } from '../shared/groupRef.mjs'
import { formatSocialPostHref, formatSocialProfileHref } from '../shared/runUri.mjs'

import { formatActionKey } from './lib/actionKey.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { viewerEntityHash } from './lib/apiClient.mjs'
import {
	authorLabel,
	entityHandle,
	formatTime,
	rememberEntityHandle,
	renderAvatarHtml,
	renderMarkdown,
	renderQuoteBlockHtml,
} from './lib/display.mjs'
import { renderEngagementBarHtml } from './lib/engagementBar.mjs'
import { renderPollHtml } from './lib/pollUi.mjs'
import { renderMediaHtml } from './mediaRender.mjs'

/**
 * @param {object} liveRef 直播引用
 * @returns {string} HTML
 */
function renderLiveRefHtml(liveRef) {
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
			${renderAvatarHtml(entityHash, null, 'live-ref-avatar')}
			<span class="live-ref-stats">${escapeHtml(geti18n('social.live.postEndedStats', { viewers, likes, duration: `${mm}:${ss}` }))}</span>
		</a>`
	}
	return `<a class="live-ref-card" href="${escapeHtml(href)}">
		<span class="live-ref-badge">LIVE</span>
		${renderAvatarHtml(entityHash, null, 'live-ref-avatar')}
		<span class="live-ref-cta">${escapeHtml(geti18n('social.live.postWatch'))}</span>
	</a>`
}

/**
 * 将单条 feed 条目渲染为帖子卡片 DOM。
 * @param {object} item feed 条目
 * @param {{ openDetail?: boolean }} [options] openDetail 默认 true；详情页自身传 false
 * @returns {Promise<HTMLElement>} 帖子卡片
 */
export async function buildPostCard(item, options = {}) {
	const isRepost = item.kind === 'repost'
	const actionEntity = item.targetEntityHash || item.entityHash
	const actionPostId = item.targetPostId || item.postId
	const actionKey = formatActionKey(actionEntity, actionPostId)
	const originalAuthor = isRepost ? item.targetEntityHash : item.entityHash
	rememberEntityHandle(item.entityHash, item.authorProfile)
	if (isRepost) rememberEntityHandle(originalAuthor, item.targetAuthorProfile)
	if (item.replyContext)
		rememberEntityHandle(item.replyContext.entityHash, item.replyContext.authorProfile)
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
		? renderQuoteBlockHtml({ ...quoteRef, text: quoteRef.text || '' })
		: ''
	const replyContext = item.replyContext
	const replyContextHtml = replyContext && !decryptFailed
		? `<a class="reply-context" href="${escapeHtml(formatSocialPostHref(replyContext.entityHash, replyContext.postId))}">
			<span class="reply-context-label">${escapeHtml(geti18n('social.reply.context', {
			author: entityHandle(replyContext.entityHash, replyContext.authorProfile),
		}))}</span>
			${replyContext.text ? `<span class="reply-context-snippet">${escapeHtml(String(replyContext.text).slice(0, 120))}</span>` : ''}
		</a>`
		: ''
	const groupRef = item.post?.content?.groupRef
	const groupRefHtml = groupRef && !decryptFailed
		? renderGroupRefBlockHtml(groupRef)
		: ''
	const pollHtml = item.poll && !decryptFailed
		? renderPollHtml(item.poll, actionKey)
		: ''
	const liveRef = item.post?.content?.liveRef
	const liveRefHtml = liveRef && !decryptFailed
		? renderLiveRefHtml(liveRef)
		: ''
	let contentBlock = `${pollHtml}${mediaHtmlRaw}${liveRefHtml}<div class="body markdown-body">${markdownBody}</div>`
	if (contentWarning && !decryptFailed)
		contentBlock = wrapContentWarningHtml(contentBlock, {
			warningLabel: contentWarning,
			revealLabel: geti18n('social.feed.revealContent'),
		})

	const viewer = viewerEntityHash()
	const isOwn = viewer && item.entityHash === viewer && !isRepost
	const itemOwner = String(item.ownerEntityHash || item.authorProfile?.ownerEntityHash || '').trim().toLowerCase()
	const isManagedPost = !isRepost && !isOwn
		&& !!viewer
		&& !!itemOwner
		&& itemOwner === String(viewer).toLowerCase()
	const canManage = isOwn || isManagedPost
	const canDelete = canManage
	const label = authorLabel(item.entityHash, item.authorProfile)
	const { visibilityDisplay } = await import('./visibilityPicker.mjs')
	const vis = visibilityDisplay(item.post?.content?.visibility, item.post?.content?.minFollowMs)
	const visLabel = geti18n(vis.labelKey)
	const visibilityCode = vis.code
	const visibilityIcon = `<span class="s-ic s-ic-${vis.icon === 'globe' ? 'globe' : 'lock'} post-visibility-icon" title="${visLabel}" aria-label="${visLabel}"></span>`
	const albumChips = (item.albums || []).length
		? `<div class="post-album-chips">${item.albums.map(album =>
			`<button type="button" class="post-album-chip" data-album-open="${escapeHtml(item.entityHash)}" data-album-id="${escapeHtml(album.albumId)}">${escapeHtml(album.name)}</button>`,
		).join('')}</div>`
		: ''
	const engagementBarHtml = await renderEngagementBarHtml(item, actionKey)
	const repostBanner = isRepost
		? `<div class="repost-banner"><span class="s-ic s-ic-repost" aria-hidden="true"></span>${geti18n('social.feed.repostedBy', { author: label })}</div>`
		: ''
	const repostCommentHtml = isRepost && item.repostComment
		? `<div class="body markdown-body repost-comment">${await renderMarkdown(item.repostComment, item.entityHash)}</div>`
		: ''
	const embeddedWrapStart = isRepost ? '<div class="embedded-post">' : ''
	const embeddedWrapEnd = isRepost ? '</div>' : ''
	const headerAuthor = isRepost
		? authorLabel(originalAuthor, item.targetAuthorProfile)
		: label
	const headerLink = isRepost
		? formatSocialProfileHref(originalAuthor)
		: formatSocialProfileHref(item.entityHash)
	const headerAvatarEntity = isRepost ? originalAuthor : item.entityHash
	const headerAvatarProfile = isRepost ? item.targetAuthorProfile : item.authorProfile
	const headerHandleEntity = isRepost ? originalAuthor : item.entityHash
	const postTime = formatTime(item.post?.hlc?.wall)
	const postDetailHref = formatSocialPostHref(actionEntity, actionPostId)
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
		authorHandle: entityHandle(headerHandleEntity, headerAvatarProfile),
		postTime,
		editedBadge,
		visibilityIcon,
		moreLabel: geti18n('social.actions.more'),
		quoteHtml,
		replyContextHtml,
		groupRefHtml,
		contentBlock,
		albumChips,
		communityNoteHtml,
		engagementBarHtml,
		actionKey,
		postDetailHref,
		entityHash: item.entityHash,
		blockButton,
		hideButton,
		muteButton,
		editButton,
		editHistoryButton,
		deleteButton,
	})
	const el = /** @type {HTMLElement} */ card
	if (options.openDetail !== false)
		bindPostCardOpen(el, `post;${actionEntity};${actionPostId}`)
	else
		el.style.cursor = 'default'
	return el
}

const POST_CARD_OPEN_EXCLUDE = 'a, button, input, textarea, select, label, .poll, .media-gallery, .live-ref-card, .post-actions, .repost-panel, .replies, .post-more-menu, .content-warning-reveal, .sensitive-media-reveal'
const LONG_PRESS_MS = 400

/**
 * 无按钮/链接的空白区短按进详情；长按/滑动/划词不进页。
 * 头像、handle、时间等已是进帖链接，由浏览器原生导航。
 * @param {HTMLElement} card 帖卡
 * @param {string} hash 目标 hash（不含 #）
 * @returns {void}
 */
function bindPostCardOpen(card, hash) {
	let longPress = false
	let timer = 0
	let startX = 0
	let startY = 0
	/**
	 *
	 */
	const clearPressTimer = () => {
		if (timer) {
			clearTimeout(timer)
			timer = 0
		}
	}
	card.addEventListener('pointerdown', event => {
		if (event.button !== 0 || !(event.target instanceof Element)) return
		if (event.target.closest(POST_CARD_OPEN_EXCLUDE)) return
		longPress = false
		startX = event.clientX
		startY = event.clientY
		clearPressTimer()
		timer = setTimeout(() => {
			longPress = true
			timer = 0
		}, LONG_PRESS_MS)
	})
	card.addEventListener('pointerup', clearPressTimer)
	card.addEventListener('pointercancel', clearPressTimer)
	card.addEventListener('click', event => {
		if (!(event.target instanceof Element)) return
		if (event.target.closest(POST_CARD_OPEN_EXCLUDE)) return
		if (longPress) {
			longPress = false
			return
		}
		if (Math.hypot(event.clientX - startX, event.clientY - startY) > 12) return
		if (getSelection()?.toString()) return
		location.hash = hash
	})
}
