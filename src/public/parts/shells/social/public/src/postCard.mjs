import { wrapContentWarningHtml } from '/scripts/features/contentReveal/index.mjs'
import { renderTemplate, renderTemplateAsHtmlString } from '../../../../scripts/features/template.mjs'
import { renderGroupRefBlockHtml } from '../shared/groupRef.mjs'
import { formatSocialPostHref, formatSocialProfileHref } from '../shared/runUri.mjs'

import { formatActionKey } from './lib/actionKey.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { viewerEntityHash } from './lib/apiClient.mjs'
import {
	authorLabel,
	entityHandle,
	formatTimeAttrs,
	rememberEntityHandle,
	renderAvatarHtml,
	renderTrustedPostMarkdown,
	renderQuoteBlockHtml,
} from './lib/display.mjs'
import { renderEngagementBarHtml } from './lib/engagementBar.mjs'
import { renderPollHtml } from './lib/pollUi.mjs'
import { renderMediaHtml } from './mediaRender.mjs'

/**
 * @param {object} liveRef 直播引用
 * @returns {Promise<string>} HTML
 */
async function renderLiveRefHtml(liveRef) {
	const entityHash = String(liveRef.entityHash || '').toLowerCase()
	const liveId = String(liveRef.liveId || '').toLowerCase()
	const ended = liveRef.status === 'ended'
	const href = escapeHtml(`#live:${entityHash}:${liveId}`)
	const avatarHtml = renderAvatarHtml(entityHash, null, 'live-ref-avatar')
	if (ended) {
		const viewers = Number(liveRef.totalViewers) || 0
		const likes = Number(liveRef.totalLikes) || 0
		const durationMs = Number(liveRef.duration) || 0
		const secs = Math.max(0, Math.round(durationMs / 1000))
		const mm = String(Math.floor(secs / 60)).padStart(2, '0')
		const ss = String(secs % 60).padStart(2, '0')
		return renderTemplateAsHtmlString('live_ref_ended', {
			href,
			avatarHtml,
			viewers,
			likes,
			duration: `${mm}:${ss}`,
		})
	}
	return renderTemplateAsHtmlString('live_ref_live', { href, avatarHtml })
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
	const text = item.post?.content?.text || ''
	const contentAuthor = isRepost ? originalAuthor : item.entityHash
	const markdownBody = decryptFailed
		? '<em data-i18n="social.feed.decryptFailed"></em>'
		: await renderTrustedPostMarkdown(text || (decryptFailed ? '' : ''), contentAuthor, {
			ownerEntityHash: item.ownerEntityHash || item.authorProfile?.ownerEntityHash
				|| (isRepost ? item.targetAuthorProfile?.ownerEntityHash : null),
		})
	const contentWarning = item.post?.content?.contentWarning?.trim()
	const sensitiveMedia = item.post?.content?.sensitiveMedia === true
		|| Boolean(contentWarning)
	const mediaHtmlRaw = decryptFailed
		? ''
		: renderMediaHtml(item.post?.content?.mediaRefs, {
			sensitive: sensitiveMedia && !contentWarning,
			warningI18n: 'social.feed.sensitiveMedia',
			revealI18n: 'social.feed.revealContent',
		})
	const quoteRef = item.post?.content?.quoteRef
	const quoteHtml = quoteRef && !decryptFailed
		? await renderQuoteBlockHtml({ ...quoteRef, text: quoteRef.text || '' })
		: ''
	const replyContext = item.replyContext
	const replyContextHtml = replyContext && !decryptFailed
		? await renderTemplateAsHtmlString('reply_context', {
			href: escapeHtml(formatSocialPostHref(replyContext.entityHash, replyContext.postId)),
			author: escapeHtml(entityHandle(replyContext.entityHash, replyContext.authorProfile)),
			snippetHtml: replyContext.text
				? `<span class="reply-context-snippet">${escapeHtml(String(replyContext.text).slice(0, 120))}</span>`
				: '',
		})
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
		? await renderLiveRefHtml(liveRef)
		: ''
	let contentBlock = `${pollHtml}${mediaHtmlRaw}${liveRefHtml}<div class="body markdown-body">${markdownBody}</div>`
	if (contentWarning && !decryptFailed)
		contentBlock = wrapContentWarningHtml(contentBlock, {
			warningLabel: contentWarning,
			revealI18n: 'social.feed.revealContent',
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
	const visibilityCode = vis.code
	const albumChips = (item.albums || []).length
		? `<div class="post-album-chips">${item.albums.map(album =>
			`<button type="button" class="post-album-chip" data-album-open="${escapeHtml(item.entityHash)}" data-album-id="${escapeHtml(album.albumId)}">${escapeHtml(album.name)}</button>`,
		).join('')}</div>`
		: ''
	const engagementBarHtml = await renderEngagementBarHtml(item, actionKey)
	const repostBanner = isRepost
		? await renderTemplateAsHtmlString('repost_banner', { author: escapeHtml(label) })
		: ''
	const repostCommentHtml = isRepost && item.repostComment
		? `<div class="body markdown-body repost-comment">${await renderTrustedPostMarkdown(item.repostComment, item.entityHash, {
			ownerEntityHash: item.ownerEntityHash || item.authorProfile?.ownerEntityHash,
		})}</div>`
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
	const timeAttrs = formatTimeAttrs(item.post?.hlc?.wall)
	const postTimeAttrs = timeAttrs.i18n
		? ` data-i18n="${timeAttrs.i18n}"${timeAttrs.n != null ? ` data-n="${timeAttrs.n}"` : ''}`
		: ''
	const postTimeText = timeAttrs.text ? escapeHtml(timeAttrs.text) : ''
	const postDetailHref = formatSocialPostHref(actionEntity, actionPostId)
	const editedBadge = item.post?.edited
		? '<span class="post-edited-badge" data-i18n="social.post.edited"></span>'
		: ''
	const treatAsOwn = canManage
	const blockButton = treatAsOwn
		? ''
		: `<button type="button" class="danger-item" data-block="${item.entityHash}"><span class="icon icon-block" aria-hidden="true"></span><span data-i18n="social.actions.block"></span></button>`
	const hideButton = treatAsOwn
		? ''
		: `<button type="button" data-hide="${item.entityHash}"><span class="icon icon-hide" aria-hidden="true"></span><span data-i18n="social.actions.hide"></span></button>`
	const muteButton = treatAsOwn
		? ''
		: `<button type="button" data-mute="${item.entityHash}"><span class="icon icon-mute" aria-hidden="true"></span><span data-i18n="social.actions.mute"></span></button>`
	const deleteButton = canDelete
		? `<button type="button" class="danger-item" data-delete="${item.postId}" data-delete-entity="${item.entityHash}"><span class="icon icon-delete" aria-hidden="true"></span><span data-i18n="social.actions.delete"></span></button>`
		: ''
	const editButton = canManage
		? `<button type="button" data-edit="${actionKey}"><span class="icon icon-edit" aria-hidden="true"></span><span data-i18n="social.actions.edit"></span></button>`
		: ''
	const editHistoryButton = canManage && item.post?.revisions?.length
		? `<button type="button" data-edit-history="${actionKey}"><span class="icon icon-history" aria-hidden="true"></span><span data-i18n="social.post.editHistory"></span></button>`
		: ''

	const topNote = item.communityNote?.topNote
	const communityNoteHtml = topNote
		? await renderTemplateAsHtmlString('community_note', {
			actionKey,
			noteId: escapeHtml(topNote.noteEventId),
			text: escapeHtml(topNote.text || ''),
			helpfulCount: topNote.helpfulCount || 0,
			unhelpfulCount: topNote.unhelpfulCount || 0,
			noteCount: item.communityNote.noteCount || 1,
		})
		: item.communityNote?.noteCount
			? await renderTemplateAsHtmlString('community_note_collapsed', {
				actionKey,
				noteCount: item.communityNote.noteCount,
			})
			: ''

	const { geti18n } = await import('/scripts/i18n/index.mjs')
	const visLabel = geti18n(vis.labelKey)
	const card = await renderTemplate('post_card', {
		postId: item.postId,
		postTextEncoded: encodeURIComponent(decryptFailed ? '' : text),
		visibilityCode,
		repostBanner,
		repostCommentHtml,
		embeddedWrapStart,
		embeddedWrapEnd,
		headerAvatarHtml: renderAvatarHtml(headerAvatarEntity, headerAvatarProfile),
		headerAuthor,
		headerLink,
		authorHandle: entityHandle(headerHandleEntity, headerAvatarProfile),
		postTimeAttrs,
		postTimeText,
		editedBadge,
		visibilityIcon: `<span class="icon icon-${vis.icon} post-visibility-icon" title="${escapeHtml(visLabel)}" aria-label="${escapeHtml(visLabel)}"></span>`,
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
	el.dataset.mediaEntity = actionEntity
	el.dataset.mediaPostId = actionPostId
	const mediaRoot = el.querySelector('.post-media')
	if (mediaRoot instanceof HTMLElement) {
		mediaRoot.dataset.mediaEntity = actionEntity
		mediaRoot.dataset.mediaPostId = actionPostId
	}
	if (options.openDetail !== false)
		bindPostCardOpen(el, `post;${actionEntity};${actionPostId}`)
	else {
		el.style.cursor = 'default'
		bindPostDetailMediaLike(el, actionEntity, actionPostId)
	}
	return el
}

const POST_CARD_OPEN_EXCLUDE = 'a, button, input, textarea, select, label, .poll, .post-media, .live-ref-card, .post-actions, .repost-panel, .replies, .post-more-menu, .content-warning-reveal, .sensitive-media-reveal'
const LONG_PRESS_MS = 400
const MEDIA_DBLCLICK_MS = 350

/**
 * 详情页：双击多媒体点赞；单击视频进短视频页。
 * @param {HTMLElement} card 帖卡
 * @param {string} entityHash 作者
 * @param {string} postId 帖 id
 * @returns {void}
 */
function bindPostDetailMediaLike(card, entityHash, postId) {
	const media = card.querySelector('.post-media')
	if (!(media instanceof HTMLElement) || media.dataset.dblLikeBound === '1') return
	media.dataset.dblLikeBound = '1'
	let lastTap = 0
	media.addEventListener('pointerup', async event => {
		if (!(event.target instanceof Element)) return
		if (event.target.closest('[data-media-nav], .post-media-dot')) return
		const now = Date.now()
		const hitVideo = Boolean(event.target.closest('[data-media-video]'))
		if (now - lastTap < MEDIA_DBLCLICK_MS) {
			lastTap = 0
			event.preventDefault()
			event.stopPropagation()
			const likeButton = card.querySelector('[data-like]')
			if (!(likeButton instanceof HTMLElement)) return
			if (likeButton.dataset.liked === '1') {
				showPostMediaHeart(media)
				return
			}
			const { applyLikeButtonOptimistic, rollbackLikeButton, runWrite } = await import('./lib/socialWrite.mjs')
			const { socialApi } = await import('./lib/apiClient.mjs')
			const snapshot = applyLikeButtonOptimistic(likeButton, true)
			showPostMediaHeart(media)
			try {
				await runWrite('like', () => socialApi(`/posts/${entityHash}/${postId}/like`, {
					method: 'POST',
					body: JSON.stringify({ like: true }),
				}))
			}
			catch {
				rollbackLikeButton(likeButton, snapshot)
			}
			return
		}
		lastTap = now
		if (!hitVideo) return
		setTimeout(() => {
			if (lastTap !== now) return
			location.hash = `videos;${entityHash};${postId}`
		}, MEDIA_DBLCLICK_MS + 10)
	})
}

/**
 * @param {HTMLElement} media 媒体根
 * @returns {void}
 */
function showPostMediaHeart(media) {
	let anim = media.querySelector('.post-media-heart')
	if (!(anim instanceof HTMLElement)) {
		anim = document.createElement('div')
		anim.className = 'post-media-heart heart-anim'
		anim.setAttribute('aria-hidden', 'true')
		media.appendChild(anim)
	}
	anim.classList.remove('hidden')
	anim.textContent = '👍'
	anim.style.animation = 'none'
	void anim.offsetWidth
	anim.style.animation = 'heartFloat 0.8s ease-out forwards'
	setTimeout(() => anim.classList.add('hidden'), 900)
}

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
