import { runSocialWrite } from '../lib/socialWrite.mjs'
import { bindVerticalSnap } from '../lib/verticalSnap.mjs'

import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { renderRepliesPanel } from './replies.mjs'
import { mediaRefUrl } from '/parts/shells:chat/shared/evfsMedia.mjs'

/** @type {{ disconnect: () => void, observe: (el: HTMLElement) => void } | null} */
let snapBind = null
let currentVideoIndex = -1
/** @type {object} */
let appCtx = null
/** @type {string | null} */
let videoCursor = null
/** @type {object[]} */
let videoShownItems = []
let videoPageLoading = false

/**
 * 加载并渲染短视频流。
 * @param {object} appContext 应用上下文
 * @returns {Promise<void>}
 */
export async function loadVideoView(appContext) {
	appCtx = appContext
	const container = document.getElementById('videoSnapContainer')
	if (!container) return

	snapBind?.disconnect()
	snapBind = null
	container.replaceChildren()
	currentVideoIndex = -1
	videoCursor = null
	videoShownItems = []
	videoPageLoading = false

	const data = await appContext.socialApi('/videos/feed?limit=20').catch(() => ({ items: [], nextCursor: null }))
	const items = data.items || []
	videoCursor = data.nextCursor || null

	if (!items.length) {
		container.innerHTML = `<div class="video-slide"><p class="video-empty">${escapeHtml(appContext.geti18n('social.video.empty'))}</p></div>`
		return
	}

	appendVideoSlides(appContext, container, items)
	videoShownItems = [...items]

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
			for (let i = 1; i <= 2; i++) {
				const next = container.children[index + i]
				const nv = next?.querySelector('video')
				if (nv) nv.preload = 'auto'
			}
			void maybeLoadMoreVideos(appContext, container, index)
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
		},
	})
}

/**
 * @param {object} appContext 应用上下文
 * @param {HTMLElement} container snap 容器
 * @param {object[]} items 条目
 * @returns {void}
 */
function appendVideoSlides(appContext, container, items) {
	for (const item of items) {
		const slide = buildVideoSlide(appContext, item)
		container.appendChild(slide)
		snapBind?.observe(slide)
	}
}

/**
 * @param {object} appContext 应用上下文
 * @param {HTMLElement} container 容器
 * @param {number} index 当前索引
 * @returns {Promise<void>}
 */
async function maybeLoadMoreVideos(appContext, container, index) {
	if (videoPageLoading) return
	const remaining = container.children.length - index - 1
	if (remaining > 2) return

	if (videoCursor) {
		videoPageLoading = true
		try {
			const data = await appContext.socialApi(
				`/videos/feed?limit=20&cursor=${encodeURIComponent(videoCursor)}`,
			).catch(() => null)
			if (!data) return
			const items = data.items || []
			videoCursor = data.nextCursor || null
			if (items.length) {
				videoShownItems.push(...items)
				appendVideoSlides(appContext, container, items)
			}
		}
		finally {
			videoPageLoading = false
		}
		return
	}

	if (!videoShownItems.length) return
	videoPageLoading = true
	try {
		appendVideoSlides(appContext, container, videoShownItems)
	}
	finally {
		videoPageLoading = false
	}
}

/**
 * @param {object} appContext 应用上下文
 * @param {object} item feed 条目
 * @returns {HTMLElement} slide 元素
 */
function buildVideoSlide(appContext, item) {
	const slide = document.createElement('div')
	slide.className = 'video-slide'
	slide.dataset.entityHash = item.entityHash || ''
	slide.dataset.postId = item.postId || ''

	const refs = item.post?.content?.mediaRefs || item.mediaRefs || []
	const mediaRef = refs.find(m => String(m?.kind || '').toLowerCase() === 'video')
	const videoSrc = mediaRef ? mediaRefUrl(mediaRef) : ''

	slide.innerHTML = `
		<video class="video-player" src="${escapeHtml(videoSrc)}" loop playsinline preload="metadata"></video>
		<div class="video-overlay">
			<div class="video-info">
				<div class="video-author">${escapeHtml(item.authorName || item.authorHandle || '')}</div>
				<div class="video-caption">${escapeHtml((item.text || '').slice(0, 120))}</div>
			</div>
			<div class="video-actions">
				<button type="button" class="video-action-btn video-like-btn" data-action="like">
					<span class="s-ic s-ic-like" aria-hidden="true"></span>
					<span class="video-like-count">${item.likeCount || 0}</span>
				</button>
				<button type="button" class="video-action-btn video-comment-btn" data-action="comment">
					<span class="s-ic s-ic-reply" aria-hidden="true"></span>
					<span>${item.replyCount || 0}</span>
				</button>
			</div>
		</div>
		<div class="heart-anim hidden" aria-hidden="true"></div>
		<div class="video-progress-bar"><div class="video-progress-fill"></div></div>
		<div class="video-replies-panel hidden" data-replies-panel></div>
	`

	const video = slide.querySelector('video')

	video?.addEventListener('timeupdate', () => {
		const fill = slide.querySelector('.video-progress-fill')
		if (fill && video.duration)
			fill.style.width = `${(video.currentTime / video.duration) * 100}%`
	})

	let lastTap = 0
	slide.addEventListener('pointerup', async event => {
		if (event.target.closest('.video-actions') || event.target.closest('.video-replies-panel')) return
		const now = Date.now()
		if (now - lastTap < 350) {
			lastTap = 0
			await doVideoLike(appContext, slide)
			showHeartAnim(slide)
		}
		else {
			lastTap = now
			setTimeout(() => {
				if (lastTap !== now) return
				if (video?.paused) video.play().catch(() => {})
				else video?.pause()
			}, 360)
		}
	})

	let pressTimer = null
	let pressStartX = 0
	let seekBaseTime = 0
	let speedMode = false

	slide.addEventListener('pointerdown', event => {
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
		void appContext.socialApi('/signals/dwell', {
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
		await doVideoLike(appContext, slide)
	})

	slide.querySelector('.video-comment-btn')?.addEventListener('click', async event => {
		event.stopPropagation()
		const panel = slide.querySelector('[data-replies-panel]')
		if (!panel) return
		panel.classList.toggle('hidden')
		if (!panel.dataset.loaded && !panel.classList.contains('hidden')) {
			const { entityHash, postId } = slide.dataset
			const data = await appContext.socialApi(`/profile/${entityHash}/replies/${postId}`).catch(() => ({ replies: [] }))
			panel.dataset.loaded = '1'
			await renderRepliesPanel(appContext, panel, data.replies || [])
		}
	})

	return slide
}

/**
 * @param {object} appContext 应用上下文
 * @param {HTMLElement} slide slide 元素
 * @returns {Promise<void>}
 */
async function doVideoLike(appContext, slide) {
	const { entityHash, postId } = slide.dataset
	if (!entityHash || !postId) return
	await runSocialWrite('like', () =>
		appContext.socialApi(`/posts/${entityHash}/${postId}/like`, { method: 'POST' }),
	)
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
 * 视频视图键盘导航处理器（绑定到 #videoView）。
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
			void maybeLoadMoreVideos(appCtx, container, currentVideoIndex + 1)
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
			if (currentSlide && appCtx) void doVideoLike(appCtx, currentSlide)
			break
		case 'm': case 'M':
			if (video) video.muted = !video.muted
			break
		case 'c': case 'C': {
			const btn = currentSlide?.querySelector('.video-comment-btn')
			btn?.click()
			break
		}
	}
}
