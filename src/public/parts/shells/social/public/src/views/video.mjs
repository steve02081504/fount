import { formatSocialProfileHref } from '../../shared/runUri.mjs'
import { shareOrCopyPostLink } from '../actions/shared.mjs'
import { formatActionKey } from '../lib/actionKey.mjs'
import { socialApi } from '../lib/apiClient.mjs'
import { authorLabel, renderAvatarHtml } from '../lib/display.mjs'
import { runSocialWrite } from '../lib/socialWrite.mjs'
import { bindVerticalSnap } from '../lib/verticalSnap.mjs'

import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { renderRepliesPanel } from './replies.mjs'
import { mediaRefUrl } from '/parts/shells:chat/shared/evfsMedia.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'

/** @type {{ disconnect: () => void, observe: (el: HTMLElement) => void } | null} */
let snapBind = null
let currentVideoIndex = -1
/** @type {string | null} */
let videoCursor = null
/** @type {object[]} */
let videoShownItems = []
let videoPageLoading = false
/** @type {WeakMap<HTMLElement, object[]>} */
const slideRepliesCache = new WeakMap()

/**
 * 加载并渲染短视频流。
 * @returns {Promise<void>}
 */
export async function loadVideoView() {
	const container = document.getElementById('videoSnapContainer')
	const view = document.getElementById('videosView')
	if (!container) return

	snapBind?.disconnect()
	snapBind = null
	container.replaceChildren()
	currentVideoIndex = -1
	videoCursor = null
	videoShownItems = []
	videoPageLoading = false

	const data = await socialApi('/videos/feed?limit=20').catch(() => ({ items: [], nextCursor: null }))
	const items = data.items || []
	videoCursor = data.nextCursor || null

	if (!items.length) {
		container.appendChild(buildVideoEmptySlide())
		view?.focus({ preventScroll: true })
		return
	}

	appendVideoSlides(container, items)
	videoShownItems = [...items]
	view?.focus({ preventScroll: true })

	snapBind = bindVerticalSnap(container, {
		/**
		 * @param {number} index 当前索引
		 * @param {HTMLElement} el slide
		 * @returns {void}
		 */
		onEnter: (index, el) => {
			currentVideoIndex = index
			const video = el.querySelector('video')
			if (video) {
				video.preload = 'auto'
				video.play().catch(() => {})
			}
			setPauseHint(el, false)
			for (let i = 1; i <= 2; i++) {
				const next = container.children[index + i]
				const nv = next?.querySelector('video')
				if (nv) nv.preload = 'auto'
			}
			void ensureCommentTicker(el)
			void maybeLoadMoreVideos(container, index)
		},
		/**
		 * @param {number} _index 离开索引
		 * @param {HTMLElement} el slide
		 * @returns {void}
		 */
		onLeave: (_index, el) => {
			const video = el.querySelector('video')
			if (video) {
				video.pause()
				video.playbackRate = 1
			}
			setPauseHint(el, true)
			closeVideoReplies(el)
		},
	})
}

/**
 * @returns {HTMLElement} 空态 slide
 */
function buildVideoEmptySlide() {
	const slide = document.createElement('div')
	slide.className = 'video-slide'
	slide.innerHTML = `
		<div class="video-empty-state">
			<span class="s-ic s-ic-video video-empty-icon" aria-hidden="true"></span>
			<p class="video-empty-title">${escapeHtml(geti18n('social.video.empty'))}</p>
			<p class="video-empty-hint">${escapeHtml(geti18n('social.video.emptyHint'))}</p>
			<button type="button" class="btn btn-primary video-empty-compose" data-video-compose>
				${escapeHtml(geti18n('social.video.compose'))}
			</button>
		</div>
	`
	slide.querySelector('[data-video-compose]')?.addEventListener('click', async () => {
		const { focusComposer } = await import('../navigation.mjs')
		await focusComposer({ switchToFeed: true })
	})
	return slide
}

/**
 * @param {HTMLElement} container snap 容器
 * @param {object[]} items 条目
 * @returns {void}
 */
function appendVideoSlides(container, items) {
	for (const item of items) {
		const slide = buildVideoSlide(item)
		container.appendChild(slide)
		snapBind?.observe(slide)
	}
}

/**
 * @param {HTMLElement} container 容器
 * @param {number} index 当前索引
 * @returns {Promise<void>}
 */
async function maybeLoadMoreVideos(container, index) {
	if (videoPageLoading) return
	const remaining = container.children.length - index - 1
	if (remaining > 2) return

	if (videoCursor) {
		videoPageLoading = true
		try {
			const data = await socialApi(
				`/videos/feed?limit=20&cursor=${encodeURIComponent(videoCursor)}`,
			).catch(() => null)
			if (!data) return
			const items = data.items || []
			videoCursor = data.nextCursor || null
			if (items.length) {
				videoShownItems.push(...items)
				appendVideoSlides(container, items)
			}
		}
		finally {
			videoPageLoading = false
		}
		return
	}

	// 循环重放：需用户已滑到末尾附近且容器真的可滚，避免单条首屏自动复制
	if (!videoShownItems.length) return
	if (index < 1 && container.scrollTop <= 0) return
	if (container.scrollHeight <= container.clientHeight) return
	videoPageLoading = true
	try {
		appendVideoSlides(container, videoShownItems)
	}
	finally {
		videoPageLoading = false
	}
}

/**
 * @param {object} item feed 条目
 * @returns {string} 可播放 URL；无则空串
 */
function resolveVideoSrc(item) {
	const refs = item.post?.content?.mediaRefs || item.mediaRefs || []
	const mediaRef = refs.find(m => String(m?.kind || '').toLowerCase() === 'video')
	if (!mediaRef) return ''
	try { return mediaRefUrl(mediaRef) }
	catch { return '' }
}

/**
 * @param {HTMLElement} slide slide
 * @param {boolean} paused 是否暂停
 * @returns {void}
 */
function setPauseHint(slide, paused) {
	slide.querySelector('.video-pause-hint')?.classList.toggle('is-visible', paused)
}

/**
 * @param {HTMLElement} slide slide
 * @param {HTMLVideoElement} video 播放器
 * @returns {void}
 */
function syncMuteButton(slide, video) {
	const btn = slide.querySelector('.video-mute-btn')
	if (!btn) return
	btn.setAttribute('aria-label', geti18n(video.muted ? 'social.video.unmute' : 'social.video.mute'))
	btn.querySelector('.s-ic')?.classList.toggle('s-ic-mute', video.muted)
	btn.querySelector('.s-ic')?.classList.toggle('s-ic-volume', !video.muted)
}

/**
 * @param {HTMLElement} slide slide
 * @returns {void}
 */
function closeVideoReplies(slide) {
	const panel = slide.querySelector('[data-replies-panel]')
	if (!panel || panel.classList.contains('hidden')) return
	panel.classList.add('hidden')
	slide.querySelector('[data-comment-ticker]')?.classList.remove('is-dimmed')
}

/**
 * 用回复列表刷新右下角轮播（回复提交后也可调用）。
 * @param {HTMLElement} slide slide
 * @param {object[]} replies 回复
 * @returns {void}
 */
export function syncVideoCommentTicker(slide, replies) {
	slideRepliesCache.set(slide, replies)
	renderCommentTicker(slide, replies)
}

/**
 * @param {HTMLElement} slide slide
 * @param {object[]} replies 回复
 * @returns {void}
 */
function renderCommentTicker(slide, replies) {
	const ticker = slide.querySelector('[data-comment-ticker]')
	if (!ticker) return
	const items = replies
		.map(reply => {
			const text = String(reply.post?.content?.text || '').trim()
			if (!text) return null
			return { author: authorLabel(reply.entityHash, reply.authorProfile), text }
		})
		.filter(Boolean)
	if (!items.length) {
		ticker.replaceChildren()
		ticker.classList.add('hidden')
		return
	}
	ticker.classList.remove('hidden')
	const track = document.createElement('div')
	track.className = 'video-comment-ticker-track'
	// 多复制一份以便无缝滚动
	const loop = items.length > 1 ? [...items, ...items] : items
	for (const item of loop) {
		const row = document.createElement('div')
		row.className = 'video-comment-ticker-item'
		row.innerHTML = `<strong>${escapeHtml(item.author)}</strong><span>${escapeHtml(item.text.slice(0, 80))}</span>`
		track.appendChild(row)
	}
	ticker.replaceChildren(track)
	track.classList.toggle('is-scrolling', items.length > 1)
	if (items.length > 1)
		track.style.setProperty('--ticker-duration', `${Math.max(8, items.length * 3.2)}s`)
}

/**
 * @param {HTMLElement} slide slide
 * @returns {Promise<object[]>} 回复列表
 */
async function loadSlideReplies(slide) {
	const cached = slideRepliesCache.get(slide)
	if (cached) return cached
	const { entityHash, postId } = slide.dataset
	if (!entityHash || !postId) return []
	const data = await socialApi(`/profile/${entityHash}/replies/${postId}`).catch(() => ({ replies: [] }))
	const replies = data.replies || []
	slideRepliesCache.set(slide, replies)
	return replies
}

/**
 * @param {HTMLElement} slide slide
 * @returns {Promise<void>}
 */
async function ensureCommentTicker(slide) {
	if (slide.dataset.tickerLoaded) return
	slide.dataset.tickerLoaded = '1'
	const replies = await loadSlideReplies(slide)
	renderCommentTicker(slide, replies)
}

/**
 * @param {HTMLElement} slide slide
 * @param {boolean} open 是否打开
 * @returns {Promise<void>}
 */
async function setVideoRepliesOpen(slide, open) {
	const panel = slide.querySelector('[data-replies-panel]')
	const ticker = slide.querySelector('[data-comment-ticker]')
	if (!panel) return
	if (!open) {
		closeVideoReplies(slide)
		return
	}
	panel.classList.remove('hidden')
	ticker?.classList.add('is-dimmed')
	if (panel.dataset.loaded) return
	const replies = await loadSlideReplies(slide)
	panel.dataset.loaded = '1'
	await renderRepliesPanel(panel, replies)
	renderCommentTicker(slide, replies)
}

/**
 * @param {object} item feed 条目
 * @returns {HTMLElement} slide 元素
 */
function buildVideoSlide(item) {
	const slide = document.createElement('div')
	slide.className = 'video-slide'
	slide.dataset.entityHash = item.entityHash || ''
	slide.dataset.postId = item.postId || ''

	const videoSrc = resolveVideoSrc(item)
	const label = authorLabel(item.entityHash, item.authorProfile)
	const caption = String(item.post?.content?.text || item.text || '').trim()
	const profileHref = formatSocialProfileHref(item.entityHash)
	const liked = Boolean(item.viewerLiked)
	const likeCount = item.likeCount || 0
	const replyCount = item.replyCount || 0
	const actionKey = formatActionKey(item.entityHash || '', item.postId || '')

	slide.innerHTML = videoSrc
		? `<video class="video-player" src="${escapeHtml(videoSrc)}" loop playsinline preload="metadata"></video>`
		: `<div class="video-media-fallback">
			<span class="s-ic s-ic-video" aria-hidden="true"></span>
			<p>${escapeHtml(geti18n('social.video.unavailable'))}</p>
		</div>`

	slide.insertAdjacentHTML('beforeend', `
		<div class="video-pause-hint" aria-hidden="true">
			<span class="s-ic s-ic-play"></span>
		</div>
		<div class="video-overlay">
			<div class="video-info">
				<a class="video-author-row" href="${escapeHtml(profileHref)}" data-video-author>
					${renderAvatarHtml(item.entityHash, item.authorProfile, 'video-author-avatar')}
					<span class="video-author">${escapeHtml(label)}</span>
				</a>
				${caption ? `<div class="video-caption">${escapeHtml(caption.slice(0, 180))}</div>` : ''}
			</div>
			<div class="video-comment-ticker hidden" data-comment-ticker aria-hidden="true"></div>
			<div class="video-actions">
				<button type="button" class="video-action-btn video-like-btn${liked ? ' is-active' : ''}" data-action="like" aria-label="${escapeHtml(geti18n('social.actions.like'))}">
					<span class="s-ic s-ic-like" aria-hidden="true"></span>
					<span class="video-like-count">${likeCount}</span>
				</button>
				<button type="button" class="video-action-btn video-comment-btn" data-action="comment" data-replies="${escapeHtml(actionKey)}" aria-label="${escapeHtml(geti18n('social.actions.replies'))}">
					<span class="s-ic s-ic-reply" aria-hidden="true"></span>
					<span class="action-count">${replyCount}</span>
				</button>
				<button type="button" class="video-action-btn video-share-btn" data-action="share" data-share="${escapeHtml(actionKey)}" aria-label="${escapeHtml(geti18n('social.actions.share'))}">
					<span class="s-ic s-ic-share" aria-hidden="true"></span>
					<span class="action-count" data-i18n="social.actions.share">${escapeHtml(geti18n('social.actions.share'))}</span>
				</button>
				<button type="button" class="video-action-btn video-mute-btn" data-action="mute" aria-label="">
					<span class="s-ic s-ic-volume" aria-hidden="true"></span>
				</button>
			</div>
		</div>
		<div class="heart-anim hidden" aria-hidden="true"></div>
		<div class="video-progress-bar"><div class="video-progress-fill"></div></div>
		<div class="video-replies-panel hidden" data-replies-panel data-replies-for="${escapeHtml(actionKey)}"></div>
	`)

	const video = slide.querySelector('video')
	if (video) syncMuteButton(slide, video)

	video?.addEventListener('timeupdate', () => {
		const fill = slide.querySelector('.video-progress-fill')
		if (fill && video.duration)
			fill.style.width = `${(video.currentTime / video.duration) * 100}%`
	})
	video?.addEventListener('play', () => setPauseHint(slide, false))
	video?.addEventListener('pause', () => setPauseHint(slide, true))

	slide.querySelector('[data-video-author]')?.addEventListener('click', event => {
		event.stopPropagation()
	})

	let lastTap = 0
	slide.addEventListener('pointerup', async event => {
		if (event.target.closest('.video-actions') || event.target.closest('.video-replies-panel') || event.target.closest('[data-video-author]'))
			return
		const panel = slide.querySelector('[data-replies-panel]')
		if (panel && !panel.classList.contains('hidden')) {
			closeVideoReplies(slide)
			return
		}
		const now = Date.now()
		if (now - lastTap < 350) {
			lastTap = 0
			await doVideoLike(slide)
			showHeartAnim(slide)
		}
		else {
			lastTap = now
			setTimeout(() => {
				if (lastTap !== now) return
				if (!video) return
				if (video.paused) video.play().catch(() => {})
				else video.pause()
			}, 360)
		}
	})

	let pressTimer = null
	let pressStartX = 0
	let seekBaseTime = 0
	let speedMode = false

	slide.addEventListener('pointerdown', event => {
		if (event.target.closest('.video-actions') || event.target.closest('.video-replies-panel') || event.target.closest('[data-video-author]'))
			return
		pressStartX = event.clientX
		pressTimer = setTimeout(() => {
			pressTimer = null
			speedMode = true
			if (video) {
				video.playbackRate = 2
				seekBaseTime = video.currentTime
			}
		}, 500)
	})

	slide.addEventListener('pointermove', event => {
		if (!speedMode || !video) return
		const dx = event.clientX - pressStartX
		video.currentTime = Math.max(0, Math.min(video.duration || 0, seekBaseTime + dx / 8))
	})

	/**
	 *
	 */
	const endPress = () => {
		if (pressTimer) { clearTimeout(pressTimer); pressTimer = null }
		if (speedMode) {
			speedMode = false
			if (video) video.playbackRate = 1
		}
	}
	slide.addEventListener('pointerup', endPress)
	slide.addEventListener('pointercancel', endPress)

	let dwellStart = null
	video?.addEventListener('play', () => { dwellStart = Date.now() })
	video?.addEventListener('pause', () => {
		if (!dwellStart || !slide.dataset.postId) return
		const watchMs = Date.now() - dwellStart
		void socialApi('/signals/dwell', {
			method: 'POST',
			body: JSON.stringify({
				entityHash: slide.dataset.entityHash,
				postId: slide.dataset.postId,
				watchMs,
				watchRatio: video.duration ? watchMs / (video.duration * 1000) : 0,
			}),
		}).catch(() => {})
		dwellStart = null
	})

	slide.querySelector('.video-like-btn')?.addEventListener('click', async event => {
		event.stopPropagation()
		await doVideoLike(slide)
	})

	slide.querySelector('.video-mute-btn')?.addEventListener('click', event => {
		event.stopPropagation()
		if (!video) return
		video.muted = !video.muted
		syncMuteButton(slide, video)
	})

	slide.querySelector('.video-share-btn')?.addEventListener('click', async event => {
		event.stopPropagation()
		const { entityHash, postId } = slide.dataset
		if (!entityHash || !postId) return
		const result = await shareOrCopyPostLink(entityHash, postId, caption || label)
		if (result !== 'copied') return
		const labelEl = slide.querySelector('.video-share-btn .action-count')
		const prev = labelEl?.textContent
		if (labelEl) labelEl.textContent = geti18n('social.actions.copied')
		setTimeout(() => {
			if (labelEl && prev != null) labelEl.textContent = prev
		}, 1500)
	})

	slide.querySelector('.video-comment-btn')?.addEventListener('click', async event => {
		event.stopPropagation()
		const panel = slide.querySelector('[data-replies-panel]')
		if (!panel) return
		const opening = panel.classList.contains('hidden')
		await setVideoRepliesOpen(slide, opening)
	})

	return slide
}

/**
 * @param {HTMLElement} slide slide 元素
 * @returns {Promise<void>}
 */
async function doVideoLike(slide) {
	const { entityHash, postId } = slide.dataset
	if (!entityHash || !postId) return
	const btn = slide.querySelector('.video-like-btn')
	if (btn?.classList.contains('is-active')) return
	await runSocialWrite('like', () =>
		socialApi(`/posts/${entityHash}/${postId}/like`, { method: 'POST' }),
	)
	btn?.classList.add('is-active')
	const countEl = slide.querySelector('.video-like-count')
	if (countEl) countEl.textContent = String(Number(countEl.textContent) + 1)
}

/**
 * 飘心动画。
 * @param {HTMLElement} slide slide 元素
 * @returns {void}
 */
function showHeartAnim(slide) {
	const anim = slide.querySelector('.heart-anim')
	if (!anim) return
	anim.classList.remove('hidden')
	anim.textContent = '❤️'
	anim.style.animation = 'none'
	void anim.offsetWidth
	anim.style.animation = 'heartFloat 0.8s ease-out forwards'
	setTimeout(() => anim.classList.add('hidden'), 900)
}

/**
 * 视频视图键盘导航处理器（绑定到 #videosView）。
 * @param {KeyboardEvent} event 键盘事件
 * @returns {void}
 */
export function handleVideoKeydown(event) {
	const container = document.getElementById('videoSnapContainer')
	if (!container) return
	const currentSlide = container.children[currentVideoIndex]
	const video = currentSlide?.querySelector('video')

	switch (event.key) {
		case 'ArrowUp':
			event.preventDefault()
			container.children[currentVideoIndex - 1]?.scrollIntoView({ behavior: 'smooth' })
			break
		case 'ArrowDown':
			event.preventDefault()
			container.children[currentVideoIndex + 1]?.scrollIntoView({ behavior: 'smooth' })
			void maybeLoadMoreVideos(container, currentVideoIndex + 1)
			break
		case ' ':
			event.preventDefault()
			if (video?.paused) video.play().catch(() => {})
			else video?.pause()
			break
		case 'ArrowLeft':
			if (video) video.currentTime = Math.max(0, video.currentTime - 5)
			break
		case 'ArrowRight':
			if (video) video.currentTime = Math.min(video.duration || 0, video.currentTime + 5)
			break
		case 'l': case 'L':
			if (currentSlide) void doVideoLike(currentSlide)
			break
		case 'm': case 'M':
			if (video && currentSlide) {
				video.muted = !video.muted
				syncMuteButton(currentSlide, video)
			}
			break
		case 'c': case 'C': {
			const btn = currentSlide?.querySelector('.video-comment-btn')
			btn?.click()
			break
		}
		case 'Escape':
			if (currentSlide) closeVideoReplies(currentSlide)
			break
	}
}
