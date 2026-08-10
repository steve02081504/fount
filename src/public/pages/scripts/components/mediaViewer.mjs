/**
 * 全屏媒体查看器（图片 / 视频）：ESC 关闭、左右切换、滚轮缩放、拖拽平移、下载。
 */
import { geti18n_nowarn, setLocalizeLogic } from '../i18n/index.mjs'

/** @typedef {{ src: string, name?: string, mimeType?: string }} MediaViewerItem */

/** @type {HTMLElement | null} */
let activeViewer = null

/**
 * @param {MediaViewerItem} item 媒体项
 * @returns {boolean} 是否视频
 */
function isVideoItem(item) {
	return String(item.mimeType || '').startsWith('video/')
		|| /\.(mp4|webm|ogg|mov)(\?|$)/i.test(item.src || '')
}

/**
 * @param {Element | null} el 目标
 * @param {string} key i18n 对象键（含 aria-label / textContent）
 * @returns {void}
 */
function applyI18nObject(el, key) {
	if (!(el instanceof Element)) return
	el.setAttribute('data-i18n', key)
	const value = geti18n_nowarn(key)
	if (!value || typeof value !== 'object' || Array.isArray(value)) return
	const aria = value['aria-label']
	if (typeof aria === 'string' && aria) el.setAttribute('aria-label', aria)
	if (typeof value.textContent === 'string' && value.textContent)
		el.textContent = value.textContent
}

/**
 * @param {HTMLElement} root 查看器根
 * @returns {void}
 */
function localizeMediaViewer(root) {
	applyI18nObject(root, 'util.mediaViewer.dialog')
	applyI18nObject(root.querySelector('.media-viewer-download'), 'util.mediaViewer.download')
	applyI18nObject(root.querySelector('.media-viewer-close'), 'util.mediaViewer.close')
	applyI18nObject(root.querySelector('.media-viewer-prev'), 'util.mediaViewer.prev')
	applyI18nObject(root.querySelector('.media-viewer-next'), 'util.mediaViewer.next')
}

/**
 * 关闭当前查看器。
 * @returns {void}
 */
export function closeMediaViewer() {
	if (!activeViewer) return
	const video = activeViewer.querySelector('video')
	if (video instanceof HTMLVideoElement) video.pause()
	activeViewer.remove()
	activeViewer = null
}

/**
 * 打开媒体查看器。
 * @param {MediaViewerItem[]} items 媒体列表
 * @param {number} [startIndex=0] 起始索引
 * @returns {void}
 */
export function openMediaViewer(items, startIndex = 0) {
	const list = (items || []).filter(item => item?.src)
	if (!list.length) return
	closeMediaViewer()

	let index = Math.max(0, Math.min(list.length - 1, Number(startIndex) || 0))
	let scale = 1
	let offsetX = 0
	let offsetY = 0
	let dragging = false
	let dragStartX = 0
	let dragStartY = 0
	let originX = 0
	let originY = 0

	const root = document.createElement('div')
	root.className = 'media-viewer'
	root.setAttribute('role', 'dialog')
	root.setAttribute('aria-modal', 'true')
	root.tabIndex = -1

	root.innerHTML = `
		<div class="media-viewer-toolbar">
			<span class="media-viewer-counter"></span>
			<span class="media-viewer-name"></span>
			<div class="media-viewer-actions">
				<button type="button" class="media-viewer-btn media-viewer-download"></button>
				<button type="button" class="media-viewer-btn media-viewer-close"></button>
			</div>
		</div>
		<button type="button" class="media-viewer-nav media-viewer-prev">‹</button>
		<button type="button" class="media-viewer-nav media-viewer-next">›</button>
		<div class="media-viewer-stage">
			<div class="media-viewer-transform"></div>
		</div>
	`
	localizeMediaViewer(root)
	setLocalizeLogic(root, () => localizeMediaViewer(root))

	const stage = root.querySelector('.media-viewer-stage')
	const transform = root.querySelector('.media-viewer-transform')
	const counter = root.querySelector('.media-viewer-counter')
	const nameEl = root.querySelector('.media-viewer-name')
	const prevBtn = root.querySelector('.media-viewer-prev')
	const nextBtn = root.querySelector('.media-viewer-next')
	const downloadBtn = root.querySelector('.media-viewer-download')
	const closeBtn = root.querySelector('.media-viewer-close')

	/**
	 * @returns {void}
	 */
	function applyTransform() {
		if (!(transform instanceof HTMLElement)) return
		transform.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`
	}

	/**
	 * @returns {void}
	 */
	function resetTransform() {
		scale = 1
		offsetX = 0
		offsetY = 0
		applyTransform()
	}

	/**
	 * @returns {void}
	 */
	function paint() {
		const item = list[index]
		if (!(transform instanceof HTMLElement)) return
		transform.replaceChildren()
		resetTransform()
		if (isVideoItem(item)) {
			const video = document.createElement('video')
			video.src = item.src
			video.controls = true
			video.autoplay = true
			video.className = 'media-viewer-media'
			transform.appendChild(video)
		}
		else {
			const img = document.createElement('img')
			img.src = item.src
			img.alt = item.name || ''
			img.className = 'media-viewer-media'
			img.draggable = false
			transform.appendChild(img)
		}
		if (counter instanceof HTMLElement)
			counter.textContent = list.length > 1 ? `${index + 1} / ${list.length}` : ''
		if (nameEl instanceof HTMLElement)
			nameEl.textContent = item.name || ''
		const multi = list.length > 1
		if (prevBtn instanceof HTMLElement) prevBtn.hidden = !multi
		if (nextBtn instanceof HTMLElement) nextBtn.hidden = !multi
	}

	/**
	 * @param {number} delta 步进
	 * @returns {void}
	 */
	function step(delta) {
		if (list.length < 2) return
		index = (index + delta + list.length) % list.length
		paint()
	}

	prevBtn?.addEventListener('click', event => {
		event.stopPropagation()
		step(-1)
	})
	nextBtn?.addEventListener('click', event => {
		event.stopPropagation()
		step(1)
	})
	closeBtn?.addEventListener('click', event => {
		event.stopPropagation()
		closeMediaViewer()
	})
	downloadBtn?.addEventListener('click', event => {
		event.stopPropagation()
		const item = list[index]
		const a = document.createElement('a')
		a.href = item.src
		a.download = item.name || 'media'
		a.rel = 'noopener'
		a.click()
	})

	root.addEventListener('click', event => {
		if (event.target === root || event.target === stage) closeMediaViewer()
	})

	/**
	 * @param {KeyboardEvent} event 键盘
	 * @returns {void}
	 */
	function onKey(event) {
		if (event.key === 'Escape') {
			event.preventDefault()
			closeMediaViewer()
		}
		else if (event.key === 'ArrowLeft') {
			event.preventDefault()
			step(-1)
		}
		else if (event.key === 'ArrowRight') {
			event.preventDefault()
			step(1)
		}
	}

	/**
	 * @param {WheelEvent} event 滚轮
	 * @returns {void}
	 */
	function onWheel(event) {
		event.preventDefault()
		const delta = event.deltaY < 0 ? 1.1 : 1 / 1.1
		scale = Math.min(8, Math.max(0.25, scale * delta))
		applyTransform()
	}

	stage?.addEventListener('wheel', onWheel, { passive: false })
	stage?.addEventListener('pointerdown', event => {
		if (!(event.target instanceof Element)) return
		if (!event.target.closest('.media-viewer-media')) return
		dragging = true
		dragStartX = event.clientX
		dragStartY = event.clientY
		originX = offsetX
		originY = offsetY
		stage.setPointerCapture?.(event.pointerId)
	})
	stage?.addEventListener('pointermove', event => {
		if (!dragging) return
		offsetX = originX + (event.clientX - dragStartX)
		offsetY = originY + (event.clientY - dragStartY)
		applyTransform()
	})
	stage?.addEventListener('pointerup', () => { dragging = false })
	stage?.addEventListener('pointercancel', () => { dragging = false })
	stage?.addEventListener('dblclick', () => resetTransform())

	document.addEventListener('keydown', onKey)
	const observer = new MutationObserver(() => {
		if (!document.body.contains(root)) {
			document.removeEventListener('keydown', onKey)
			observer.disconnect()
			if (activeViewer === root) activeViewer = null
		}
	})
	observer.observe(document.body, { childList: true })

	document.body.appendChild(root)
	activeViewer = root
	paint()
	root.focus()
}

document.head.prepend(Object.assign(document.createElement('style'), {
	textContent: /* css */ `\
.media-viewer {
	position: fixed;
	inset: 0;
	z-index: 10000;
	display: flex;
	flex-direction: column;
	background: rgba(0, 0, 0, 0.88);
	color: #fff;
	outline: none;
}
.media-viewer-toolbar {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 10px 16px;
	background: rgba(0, 0, 0, 0.45);
	flex-shrink: 0;
}
.media-viewer-counter {
	font-variant-numeric: tabular-nums;
	opacity: 0.85;
	min-width: 4em;
}
.media-viewer-name {
	flex: 1;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	opacity: 0.9;
}
.media-viewer-actions {
	display: flex;
	gap: 8px;
}
.media-viewer-btn {
	border: 0;
	border-radius: 6px;
	padding: 6px 12px;
	background: rgba(255, 255, 255, 0.12);
	color: inherit;
	cursor: pointer;
}
.media-viewer-btn:hover {
	background: rgba(255, 255, 255, 0.22);
}
.media-viewer-stage {
	flex: 1;
	min-height: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	overflow: hidden;
	cursor: zoom-out;
}
.media-viewer-transform {
	transform-origin: center center;
	will-change: transform;
	max-width: 100%;
	max-height: 100%;
}
.media-viewer-media {
	display: block;
	max-width: min(96vw, 1400px);
	max-height: calc(100dvh - 64px);
	object-fit: contain;
	user-select: none;
	cursor: grab;
}
.media-viewer-nav {
	position: absolute;
	top: 50%;
	transform: translateY(-50%);
	z-index: 1;
	width: 44px;
	height: 64px;
	border: 0;
	border-radius: 8px;
	background: rgba(255, 255, 255, 0.12);
	color: #fff;
	font-size: 28px;
	cursor: pointer;
}
.media-viewer-prev { left: 12px; }
.media-viewer-next { right: 12px; }
.media-viewer-nav:hover {
	background: rgba(255, 255, 255, 0.24);
}
`,
}))
