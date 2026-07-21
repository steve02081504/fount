/**
 * Feed / 详情帖内视频：进入视野静音循环播放，离开暂停。
 */

/** @type {IntersectionObserver | null} */
let feedVideoObserver = null

/**
 * @returns {IntersectionObserver} 共享 IO
 */
function getFeedVideoObserver() {
	if (feedVideoObserver) return feedVideoObserver
	feedVideoObserver = new IntersectionObserver(entries => {
		for (const entry of entries) {
			const video = entry.target
			if (!(video instanceof HTMLVideoElement)) continue
			if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
				if (video.closest('[data-cw-collapsed="1"], [data-sensitive-collapsed="1"]')) continue
				video.muted = true
				video.play().catch(() => {})
			}
			else
				video.pause()
		}
	}, { threshold: [0, 0.5, 0.75] })
	return feedVideoObserver
}

/**
 * 观察容器内帖子视频（可重复调用，幂等观察）。
 * @param {ParentNode | null | undefined} root 容器
 * @returns {void}
 */
export function bindFeedVideoAutoplay(root) {
	if (!root) return
	const observer = getFeedVideoObserver()
	for (const video of root.querySelectorAll('video.post-media-video')) {
		if (!(video instanceof HTMLVideoElement)) continue
		video.muted = true
		video.loop = true
		video.playsInline = true
		observer.observe(video)
	}
}

/**
 * 对刚展开的 CW / 敏感遮罩内视频立即播放。
 * @param {Element | null | undefined} wrap 展开后的 wrap
 * @returns {void}
 */
export function playRevealedPostVideos(wrap) {
	if (!(wrap instanceof Element)) return
	for (const video of wrap.querySelectorAll('video.post-media-video')) {
		if (!(video instanceof HTMLVideoElement)) continue
		video.muted = true
		video.loop = true
		video.playsInline = true
		getFeedVideoObserver().observe(video)
		video.play().catch(() => {})
	}
}

/**
 * 暂停页面上所有帖子/短视频播放器。
 * @param {ParentNode | null | undefined} [scope=document] 作用域
 * @returns {void}
 */
export function pauseAllVideos(scope = document) {
	if (!scope) return
	for (const video of scope.querySelectorAll('video.post-media-video, video.video-player')) 
		if (video instanceof HTMLVideoElement)
			video.pause()
	
}
