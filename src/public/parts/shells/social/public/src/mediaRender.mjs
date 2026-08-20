/**
 * Social 媒体渲染（与上传解耦）：轮播、alt、敏感遮罩、lightbox。
 */
import { wrapSensitiveMediaHtml } from '/scripts/features/contentReveal.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { fetchMediaRef } from '/scripts/endpoints/p2p/evfsMedia.mjs'
import { hasSpeechRecognitionSource, recognizeBuffer } from '/scripts/features/speechRecognition.mjs'
import { getCachedSpeechRecognitionTranscript, setCachedSpeechRecognitionTranscript } from '/scripts/features/speechRecognitionCache.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'
import { mediaRefUrl } from '/parts/shells:chat/shared/evfsMedia.mjs'

/**
 * @param {object} ref 媒体引用
 * @param {number} index 序号
 * @returns {string} 单项 HTML；非法 url 返回空串
 */
function renderMediaItem(ref, index) {
	let url
	try {
		url = mediaRefUrl(ref)
	}
	catch {
		return ''
	}
	const mimeType = ref.mimeType || ''
	const kind = ref.kind || (mimeType.startsWith('video/') ? 'video' : mimeType.startsWith('audio/') ? 'audio' : 'image')
	const alt = escapeHtml(String(ref.alt || ref.name || ''))
	if (kind === 'image')
		return `<button type="button" class="post-media-slide" data-media-index="${index}" data-media-lightbox="${escapeHtml(url)}" data-media-alt="${alt}">
			<img src="${escapeHtml(url)}" alt="${alt}" loading="lazy" class="post-media-item" />
		</button>`
	if (kind === 'video')
		return `<div class="post-media-slide" data-media-index="${index}" data-media-video>
			<video src="${escapeHtml(url)}" muted loop playsinline preload="metadata" class="post-media-item post-media-video"></video>
		</div>`
	if (kind === 'audio') {
		const transcript = escapeHtml(String(ref.alt || ''))
		return `<div class="post-media-slide post-media-audio" data-media-index="${index}" data-media-audio>
			<audio src="${escapeHtml(url)}" controls preload="metadata" class="post-media-item"></audio>
			${transcript ? `<p class="attachment-transcript text-xs opacity-70" user-content>${transcript}</p>` : ''}
			<details class="dropdown post-audio-menu">
				<summary class="btn btn-ghost btn-xs" data-i18n="chat.attachment.buttons.more"></summary>
				<ul class="menu menu-sm bg-base-100 rounded-box shadow border border-base-300 w-36 p-1">
					<li><a href="${escapeHtml(url)}" download data-i18n="chat.attachment.buttons.download"></a></li>
					<li><button type="button" class="post-audio-speech-recognition" data-media-url="${escapeHtml(url)}" data-i18n="chat.attachment.buttons.recognize"></button></li>
				</ul>
			</details>
		</div>`
	}
	return `<a href="${escapeHtml(url)}" class="post-media-slide post-media-file link-btn" download>${escapeHtml(ref.name || 'file')}</a>`
}

/**
 * 将 mediaRefs 渲染为帖子内嵌媒体 HTML（多图横向轮播）。
 * @param {object[] | string[]} mediaRefs 媒体引用
 * @param {{ sensitive?: boolean, warningLabel?: string, revealLabel?: string, warningI18n?: string, revealI18n?: string }} [options] 敏感遮罩选项
 * @returns {string} HTML
 */
export function renderMediaHtml(mediaRefs, options = {}) {
	if (!mediaRefs?.length) return ''
	const rendered = mediaRefs.map((ref, index) => renderMediaItem(ref, index)).filter(Boolean)
	if (!rendered.length) return ''
	const items = rendered.join('')
	const dots = rendered.length > 1
		? `<div class="post-media-dots" aria-hidden="true">${rendered.map((_, index) =>
			`<span class="post-media-dot${index === 0 ? ' active' : ''}" data-media-dot="${index}"></span>`).join('')}</div>`
		: ''
	const nav = rendered.length > 1
		? `<button type="button" class="post-media-nav post-media-prev" data-media-nav="-1" aria-label="prev">‹</button>
			<button type="button" class="post-media-nav post-media-next" data-media-nav="1" aria-label="next">›</button>`
		: ''
	let html = `<div class="post-media ${rendered.length > 1 ? 'post-media-carousel' : ''}" data-media-count="${rendered.length}">
		<div class="post-media-track">${items}</div>
		${nav}
		${dots}
	</div>`
	if (options.sensitive)
		html = wrapSensitiveMediaHtml(html, {
			warningLabel: options.warningLabel || '',
			revealLabel: options.revealLabel || 'Reveal',
			warningI18n: options.warningI18n,
			revealI18n: options.revealI18n,
		})
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
		const videoSlide = event.target instanceof Element ? event.target.closest('[data-media-video]') : null
		if (videoSlide instanceof HTMLElement) {
			if (videoSlide.closest('.post-detail-card')) return
			const media = videoSlide.closest('.post-media')
			const card = videoSlide.closest('.post-card')
			const entityHash = media?.dataset.mediaEntity || card?.dataset.mediaEntity || card?.dataset.authorEntity
			const postId = media?.dataset.mediaPostId || card?.dataset.mediaPostId || card?.dataset.postId
			if (entityHash && postId) {
				event.preventDefault()
				event.stopPropagation()
				location.hash = `videos;${entityHash};${postId}`
			}
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
 * 绑定帖子内嵌音频的语音识别按钮（复用编写器识别逻辑；委托事件可重复绑定，幂等靠 dataset 标记）。
 * @param {HTMLElement} root 帖子或 feed 根
 * @returns {void}
 */
export function bindAudioSpeechRecognition(root) {
	if (!(root instanceof HTMLElement) || root.dataset.audioSpeechRecognitionBound === '1') return
	root.dataset.audioSpeechRecognitionBound = '1'
	root.addEventListener('click', event => {
		const button = event.target instanceof Element ? event.target.closest('.post-audio-speech-recognition') : null
		if (!(button instanceof HTMLButtonElement) || button.disabled) return
		void recognizePostAudio(button)
	})
}

/**
 * @param {HTMLButtonElement} button 识别按钮
 * @returns {Promise<void>}
 */
async function recognizePostAudio(button) {
	if (!await hasSpeechRecognitionSource()) return
	const url = button.dataset.mediaUrl
	if (!url) return
	const slide = button.closest('.post-media-audio')
	/**
	 * @param {string} text 转写文本
	 * @returns {void}
	 */
	const applyTranscript = (text) => {
		let caption = slide?.querySelector('.attachment-transcript')
		if (!caption) {
			caption = document.createElement('p')
			caption.className = 'attachment-transcript text-xs opacity-70'
			caption.setAttribute('user-content', '')
			slide?.querySelector('audio')?.after(caption)
		}
		caption.textContent = text
	}
	const cached = getCachedSpeechRecognitionTranscript(url)
	if (cached) {
		applyTranscript(cached)
		return
	}
	button.disabled = true
	try {
		const { buffer, mimeType } = await fetchMediaRef({ url })
		const result = await recognizeBuffer({ audio: new Uint8Array(buffer), mime_type: mimeType })
		setCachedSpeechRecognitionTranscript(url, result.text)
		applyTranscript(result.text)
	}
	catch (error) {
		showToastI18n('error', 'chat.voiceRecording.speechRecognitionFailed', { error: error?.message || String(error) })
	}
	finally {
		button.disabled = false
	}
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
			<button type="button" class="btn btn-sm btn-square btn-ghost media-lightbox-close" data-lightbox-close data-i18n="social.dialog.close">✕</button>
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
 * @param {{ onEditImage?: (index: number, ref: object) => void | Promise<void> }} [options] 选项
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
				edit.dataset.i18n = 'util.imageEditor.image'
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
		else if (ref.kind === 'audio') {
			const audio = document.createElement('audio')
			audio.src = url
			audio.controls = true
			audio.className = 'media-chip-audio'
			chip.appendChild(audio)
		}
		else
			chip.textContent = ref.name || ref.path?.split('/').pop() || 'file'

		const altInput = document.createElement('input')
		altInput.type = 'text'
		altInput.className = 'media-chip-alt input input-bordered input-xs'
		altInput.maxLength = 1500
		altInput.dataset.i18n = ref.kind === 'audio' ? 'social.composer.audioTranscript' : 'social.composer.media'
		altInput.value = ref.alt || ''
		altInput.addEventListener('input', () => {
			ref.alt = altInput.value.trim()
		})
		chip.appendChild(altInput)

		if (ref.kind === 'audio') {
			const recognizeBtn = document.createElement('button')
			recognizeBtn.type = 'button'
			recognizeBtn.className = 'media-chip-speech-recognition btn btn-ghost btn-xs'
			recognizeBtn.dataset.i18n = 'chat.attachment.buttons.recognize'
			recognizeBtn.addEventListener('click', async () => {
				try {
					const { hasSpeechRecognitionSource, recognizeBuffer } = await import('/scripts/features/speechRecognition.mjs')
					if (!await hasSpeechRecognitionSource()) return
					const { file } = ref
					if (!(file instanceof Blob)) return
					const result = await recognizeBuffer({
						audio: file,
						mime_type: ref.mimeType,
						name: ref.name,
					})
					ref.alt = result.text
					altInput.value = result.text
				}
				catch (error) {
					const { showToastI18n } = await import('/scripts/features/toast.mjs')
					showToastI18n('error', 'social.composer.speechRecognitionFailed', { error: error?.message || String(error) })
				}
			})
			chip.appendChild(recognizeBtn)
		}

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
