/**
 * Social 媒体渲染（与上传解耦）：轮播、alt、敏感遮罩、lightbox。
 */
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { mediaRefUrl } from '/parts/shells:chat/shared/evfsMedia.mjs'

/**
 * @param {object} ref 媒体引用
 * @param {number} index 序号
 * @returns {string} 单项 HTML
 */
function renderMediaItem(ref, index) {
	const url = mediaRefUrl(ref)
	const mimeType = ref.mimeType || ''
	const kind = ref.kind || (mimeType.startsWith('video/') ? 'video' : 'image')
	const alt = escapeHtml(String(ref.alt || ref.name || ''))
	if (kind === 'image')
		return `<button type="button" class="post-media-slide" data-media-index="${index}" data-media-lightbox="${escapeHtml(url)}" data-media-alt="${alt}">
			<img src="${escapeHtml(url)}" alt="${alt}" loading="lazy" class="post-media-item" />
		</button>`
	if (kind === 'video')
		return `<div class="post-media-slide" data-media-index="${index}">
			<video src="${escapeHtml(url)}" controls preload="metadata" class="post-media-item post-media-video"></video>
		</div>`
	return `<a href="${escapeHtml(url)}" class="post-media-slide post-media-file link-btn" download>${escapeHtml(ref.name || 'file')}</a>`
}

/**
 * 将 mediaRefs 渲染为帖子内嵌媒体 HTML（多图横向轮播）。
 * @param {object[] | string[]} mediaRefs 媒体引用
 * @param {{ sensitive?: boolean, warningLabel?: string, revealLabel?: string }} [options] 敏感遮罩选项
 * @returns {string} HTML
 */
export function renderMediaHtml(mediaRefs, options = {}) {
	if (!mediaRefs?.length) return ''
	const items = mediaRefs.map((ref, index) => renderMediaItem(ref, index)).join('')
	const dots = mediaRefs.length > 1
		? `<div class="post-media-dots" aria-hidden="true">${mediaRefs.map((_, index) =>
			`<span class="post-media-dot${index === 0 ? ' active' : ''}" data-media-dot="${index}"></span>`).join('')}</div>`
		: ''
	const nav = mediaRefs.length > 1
		? `<button type="button" class="post-media-nav post-media-prev" data-media-nav="-1" aria-label="prev">‹</button>
			<button type="button" class="post-media-nav post-media-next" data-media-nav="1" aria-label="next">›</button>`
		: ''
	let html = `<div class="post-media ${mediaRefs.length > 1 ? 'post-media-carousel' : ''}" data-media-count="${mediaRefs.length}">
		<div class="post-media-track">${items}</div>
		${nav}
		${dots}
	</div>`
	if (options.sensitive) {
		const label = escapeHtml(options.warningLabel || '')
		const reveal = escapeHtml(options.revealLabel || 'Reveal')
		html = `<div class="sensitive-media-wrap" data-sensitive-collapsed="1">
			<div class="sensitive-media-overlay">
				<div class="sensitive-media-label">${label}</div>
				<button type="button" class="sensitive-media-reveal">${reveal}</button>
			</div>
			<div class="sensitive-media-body">${html}</div>
		</div>`
	}
	return html
}

/**
 * 绑定轮播轨道滚动与圆点同步（委托事件可重复调用，幂等靠 closest）。
 * @param {HTMLElement} root 卡片或 feed 根
 * @returns {void}
 */
export function bindMediaCarousel(root) {
	if (!(root instanceof HTMLElement) || root.dataset.mediaCarouselBound === '1') return
	root.dataset.mediaCarouselBound = '1'
	root.addEventListener('click', event => {
		const nav = event.target instanceof Element ? event.target.closest('[data-media-nav]') : null
		if (nav instanceof HTMLElement) {
			const carousel = nav.closest('.post-media-carousel')
			const track = carousel?.querySelector('.post-media-track')
			if (!(track instanceof HTMLElement)) return
			const delta = Number(nav.dataset.mediaNav) || 0
			const width = track.clientWidth || 1
			track.scrollBy({ left: delta * width, behavior: 'smooth' })
			return
		}
		const lightboxBtn = event.target instanceof Element ? event.target.closest('[data-media-lightbox]') : null
		if (lightboxBtn instanceof HTMLElement && lightboxBtn.dataset.mediaLightbox)
			openMediaLightbox(lightboxBtn.closest('.post-media'), Number(lightboxBtn.dataset.mediaIndex) || 0)
	})
	root.addEventListener('scroll', event => {
		const track = event.target
		if (!(track instanceof HTMLElement) || !track.classList.contains('post-media-track')) return
		const carousel = track.closest('.post-media')
		if (!carousel) return
		const width = track.clientWidth || 1
		const index = Math.round(track.scrollLeft / width)
		for (const dot of carousel.querySelectorAll('.post-media-dot'))
			dot.classList.toggle('active', Number(dot.dataset.mediaDot) === index)
	}, true)
}

/**
 * @param {Element | null} mediaRoot 媒体根
 * @param {number} startIndex 起始索引
 * @returns {void}
 */
export function openMediaLightbox(mediaRoot, startIndex = 0) {
	if (!(mediaRoot instanceof HTMLElement)) return
	const slides = [...mediaRoot.querySelectorAll('[data-media-lightbox]')]
	if (!slides.length) return
	let index = Math.max(0, Math.min(startIndex, slides.length - 1))
	const dialog = document.createElement('dialog')
	dialog.className = 'modal media-lightbox-modal'
	dialog.innerHTML = `
		<div class="modal-box media-lightbox-box">
			<button type="button" class="btn btn-sm btn-circle btn-ghost media-lightbox-close" data-lightbox-close aria-label="close">✕</button>
			<img class="media-lightbox-img" alt="" />
			<p class="media-lightbox-alt"></p>
			<div class="media-lightbox-nav">
				<button type="button" class="btn btn-ghost" data-lightbox-nav="-1">‹</button>
				<span class="media-lightbox-counter"></span>
				<button type="button" class="btn btn-ghost" data-lightbox-nav="1">›</button>
			</div>
		</div>
		<form method="dialog" class="modal-backdrop"><button>close</button></form>
	`
	document.body.appendChild(dialog)
	const img = dialog.querySelector('.media-lightbox-img')
	const altEl = dialog.querySelector('.media-lightbox-alt')
	const counter = dialog.querySelector('.media-lightbox-counter')
	/**
	 * @returns {void}
	 */
	function paint() {
		const slide = slides[index]
		const url = slide.dataset.mediaLightbox || ''
		const alt = slide.dataset.mediaAlt || ''
		if (img instanceof HTMLImageElement) {
			img.src = url
			img.alt = alt
		}
		if (altEl) altEl.textContent = alt
		if (counter) counter.textContent = `${index + 1} / ${slides.length}`
	}
	paint()
	dialog.addEventListener('click', event => {
		const close = event.target instanceof Element ? event.target.closest('[data-lightbox-close]') : null
		if (close) {
			dialog.close()
			return
		}
		const nav = event.target instanceof Element ? event.target.closest('[data-lightbox-nav]') : null
		if (!(nav instanceof HTMLElement)) return
		index = (index + Number(nav.dataset.lightboxNav || 0) + slides.length) % slides.length
		paint()
	})
	dialog.addEventListener('keydown', event => {
		if (event.key === 'ArrowLeft') {
			index = (index - 1 + slides.length) % slides.length
			paint()
		}
		else if (event.key === 'ArrowRight') {
			index = (index + 1) % slides.length
			paint()
		}
	})
	dialog.addEventListener('close', () => dialog.remove(), { once: true })
	dialog.showModal()
}

/**
 * 渲染 composer 待发布媒体预览区（含 alt 输入与图片编辑入口）。
 * @param {HTMLElement} container 预览区
 * @param {object[]} refs 待发布媒体
 * @param {() => void} onChange 变更回调
 * @param {{ onEditImage?: (index: number, ref: object) => void | Promise<void>, altPlaceholder?: string, editLabel?: string }} [options] 选项
 * @returns {void}
 */
export function renderMediaPreview(container, refs, onChange, options = {}) {
	container.innerHTML = ''
	if (!refs.length) {
		container.classList.add('hidden')
		return
	}
	container.classList.remove('hidden')
	for (const [index, ref] of refs.entries()) {
		const chip = document.createElement('div')
		chip.className = 'media-chip media-chip-editable'
		const url = ref.objectUrl || mediaRefUrl(ref)
		if (ref.kind === 'image') {
			const img = document.createElement('img')
			img.src = url
			img.alt = ref.alt || ref.name || ''
			chip.appendChild(img)
			if (options.onEditImage) {
				const edit = document.createElement('button')
				edit.type = 'button'
				edit.className = 'media-chip-edit'
				edit.textContent = options.editLabel || 'Edit'
				edit.addEventListener('click', () => {
					void options.onEditImage?.(index, ref)
				})
				chip.appendChild(edit)
			}
		}
		else if (ref.kind === 'video') {
			const video = document.createElement('video')
			video.src = url
			video.muted = true
			chip.appendChild(video)
		}
		else
			chip.textContent = ref.name || ref.path?.split('/').pop() || 'file'

		const altInput = document.createElement('input')
		altInput.type = 'text'
		altInput.className = 'media-chip-alt input input-bordered input-xs'
		altInput.maxLength = 1500
		altInput.placeholder = options.altPlaceholder || 'alt'
		altInput.value = ref.alt || ''
		altInput.addEventListener('input', () => {
			ref.alt = altInput.value.trim()
		})
		chip.appendChild(altInput)

		const remove = document.createElement('button')
		remove.type = 'button'
		remove.className = 'media-chip-remove'
		remove.textContent = '×'
		remove.addEventListener('click', () => {
			if (ref.objectUrl) URL.revokeObjectURL(ref.objectUrl)
			refs.splice(index, 1)
			onChange()
		})
		chip.appendChild(remove)
		container.appendChild(chip)
	}
}
