/**
 * Social 媒体渲染（与上传解耦）。
 */
import { mediaRefUrl } from '/parts/shells:chat/shared/evfsMedia.mjs'

/**
 * 将 mediaRefs 渲染为帖子内嵌媒体 HTML。
 * @param {object[] | string[]} mediaRefs 媒体引用
 * @returns {string} HTML
 */
export function renderMediaHtml(mediaRefs) {
	if (!mediaRefs?.length) return ''
	const items = mediaRefs.map(ref => {
		const url = mediaRefUrl(ref)
		const mimeType = ref.mimeType || ''
		const kind = ref.kind || (mimeType.startsWith('video/') ? 'video' : 'image')
		if (kind === 'image')
			return `<img src="${url}" alt="" loading="lazy" class="post-media-item" />`
		if (kind === 'video')
			return `<video src="${url}" controls preload="metadata" class="post-media-item post-media-video"></video>`
		return `<a href="${url}" class="post-media-file link-btn" download>${ref.name || 'file'}</a>`
	}).join('')
	return `<div class="post-media">${items}</div>`
}

/**
 * 渲染 composer 待发布媒体预览区。
 * @param {HTMLElement} container 预览区
 * @param {object[]} refs 待发布媒体
 * @param {() => void} onChange 变更回调
 * @returns {void}
 */
export function renderMediaPreview(container, refs, onChange) {
	container.innerHTML = ''
	if (!refs.length) {
		container.classList.add('hidden')
		return
	}
	container.classList.remove('hidden')
	for (const [index, ref] of refs.entries()) {
		const chip = document.createElement('div')
		chip.className = 'media-chip'
		const url = mediaRefUrl(ref)
		if (ref.kind === 'image') {
			const img = document.createElement('img')
			img.src = url
			img.alt = ref.name || ''
			chip.appendChild(img)
		}
		else if (ref.kind === 'video') {
			const video = document.createElement('video')
			video.src = url
			video.muted = true
			chip.appendChild(video)
		}
		else
			chip.textContent = ref.name || ref.path?.split('/').pop() || 'file'

		const remove = document.createElement('button')
		remove.type = 'button'
		remove.className = 'media-chip-remove'
		remove.textContent = '×'
		remove.addEventListener('click', () => {
			refs.splice(index, 1)
			onChange()
		})
		chip.appendChild(remove)
		container.appendChild(chip)
	}
}
