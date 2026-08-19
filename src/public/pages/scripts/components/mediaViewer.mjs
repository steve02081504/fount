/**
 * 全屏媒体查看器（图片 / 视频）：ESC 关闭、左右切换、滚轮缩放、拖拽平移、下载。
 * 使用原生 `<dialog>` + `showModal()` 以获得焦点约束。
 */
import { setElementI18n, setLocalizeLogic } from '../i18n/index.mjs'
import { onElementRemoved } from '../lib/onElementRemoved.mjs'

/** @typedef {{ src: string, name?: string, mimeType?: string }} MediaViewerItem */

/** @type {HTMLDialogElement | null} */
let activeViewer = null
/** @type {(() => void) | null} */
let detachActiveViewer = null

/**
 * @param {MediaViewerItem} item 媒体项
 * @returns {boolean} 是否视频
 */
function isVideoItem(item) {
	return (item.mimeType || '').startsWith('video/')
		|| /\.(mp4|webm|ogg|mov)(\?|$)/i.test(item.src || '')
}

/**
 * @param {HTMLElement} root 查看器根
 * @returns {void}
 */
function localizeMediaViewer(root) {
	setElementI18n(root, 'util.mediaViewer.dialog')
	setElementI18n(root.querySelector('.media-viewer-backdrop'), 'util.mediaViewer.close')
	setElementI18n(root.querySelector('.media-viewer-download'), 'util.mediaViewer.download')
	setElementI18n(root.querySelector('.media-viewer-close'), 'util.mediaViewer.close')
	setElementI18n(root.querySelector('.media-viewer-prev'), 'util.mediaViewer.prev')
	setElementI18n(root.querySelector('.media-viewer-next'), 'util.mediaViewer.next')
}

/**
 * 构建查看器骨架（原生 dialog + DaisyUI modal 语义）。
 * @returns {HTMLDialogElement} 查看器根
 */
function createViewerRoot() {
	const root = document.createElement('dialog')
	root.className = 'media-viewer modal'
	root.setAttribute('aria-modal', 'true')
	root.innerHTML = `
		<div class="modal-box media-viewer-panel p-0 max-w-none w-screen h-screen max-h-screen rounded-none">
			<div class="media-viewer-toolbar">
				<span class="media-viewer-counter"></span>
				<span class="media-viewer-name"></span>
				<div class="media-viewer-actions">
					<button type="button" class="btn btn-sm btn-ghost media-viewer-download"></button>
					<button type="button" class="btn btn-sm btn-ghost media-viewer-close"></button>
				</div>
			</div>
			<button type="button" class="btn btn-square btn-ghost media-viewer-nav media-viewer-prev">‹</button>
			<button type="button" class="btn btn-square btn-ghost media-viewer-nav media-viewer-next">›</button>
			<div class="media-viewer-stage">
				<div class="media-viewer-transform"></div>
			</div>
		</div>
		<form method="dialog" class="modal-backdrop media-viewer-backdrop"><button type="submit"></button></form>
	`
	localizeMediaViewer(root)
	setLocalizeLogic(root, () => localizeMediaViewer(root))
	return root
}

/**
 * 绑定舞台的滚轮缩放与拖拽平移。
 * @param {HTMLElement} stage 舞台
 * @param {HTMLElement} transform 变换容器
 * @returns {() => void} 复位变换
 */
function bindStageTransform(stage, transform) {
	let scale = 1
	let offsetX = 0
	let offsetY = 0
	let dragging = false
	let dragStartX = 0
	let dragStartY = 0
	let originX = 0
	let originY = 0

	/** 把拖拽/缩放写回 transform。 */
	const applyTransform = () => {
		transform.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`
	}
	/** 重置缩放与位移。 */
	const resetTransform = () => {
		scale = 1
		offsetX = 0
		offsetY = 0
		applyTransform()
	}

	stage.addEventListener('wheel', event => {
		event.preventDefault()
		scale = Math.min(8, Math.max(0.25, scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1)))
		applyTransform()
	}, { passive: false })
	stage.addEventListener('pointerdown', event => {
		if (!event.target.closest?.('.media-viewer-media')) return
		dragging = true
		dragStartX = event.clientX
		dragStartY = event.clientY
		originX = offsetX
		originY = offsetY
		stage.setPointerCapture?.(event.pointerId)
	})
	stage.addEventListener('pointermove', event => {
		if (!dragging) return
		offsetX = originX + (event.clientX - dragStartX)
		offsetY = originY + (event.clientY - dragStartY)
		applyTransform()
	})
	stage.addEventListener('pointerup', () => { dragging = false })
	stage.addEventListener('pointercancel', () => { dragging = false })
	stage.addEventListener('dblclick', resetTransform)

	return resetTransform
}

/**
 * 关闭当前查看器。
 * @returns {void}
 */
export function closeMediaViewer() {
	if (!activeViewer) return
	activeViewer.querySelector('video')?.pause()
	if (activeViewer.open) activeViewer.close()
	else activeViewer.remove()
}

/**
 * 打开媒体查看器。
 * @param {MediaViewerItem[]} items 媒体列表
 * @param {number} [startIndex=0] 起始索引
 * @returns {void}
 */
export function openMediaViewer(items, startIndex = 0) {
	const list = items.filter(item => item?.src)
	if (!list.length) return
	closeMediaViewer()

	let index = Math.max(0, Math.min(list.length - 1, startIndex))

	const root = createViewerRoot()
	const stage = root.querySelector('.media-viewer-stage')
	const transform = root.querySelector('.media-viewer-transform')
	const counter = root.querySelector('.media-viewer-counter')
	const nameEl = root.querySelector('.media-viewer-name')
	const prevBtn = root.querySelector('.media-viewer-prev')
	const nextBtn = root.querySelector('.media-viewer-next')
	const resetTransform = bindStageTransform(stage, transform)

	/**
	 * 渲染当前索引对应的媒体。
	 * @returns {void}
	 */
	function paint() {
		const item = list[index]
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
		counter.textContent = list.length > 1 ? `${index + 1} / ${list.length}` : ''
		nameEl.textContent = item.name || ''
		prevBtn.hidden = nextBtn.hidden = list.length < 2
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

	/**
	 * @param {KeyboardEvent} event 键盘
	 * @returns {void}
	 */
	function onKey(event) {
		if (event.key === 'Escape') {
			event.preventDefault()
			closeMediaViewer()
			return
		}
		const inVideoControls = event.target instanceof Element
			&& !!event.target.closest('video')
		if (inVideoControls && (event.key === 'ArrowLeft' || event.key === 'ArrowRight'))
			return
		if (event.key === 'ArrowLeft') {
			event.preventDefault()
			step(-1)
		}
		else if (event.key === 'ArrowRight') {
			event.preventDefault()
			step(1)
		}
	}

	prevBtn.addEventListener('click', event => {
		event.stopPropagation()
		step(-1)
	})
	nextBtn.addEventListener('click', event => {
		event.stopPropagation()
		step(1)
	})
	root.querySelector('.media-viewer-close').addEventListener('click', event => {
		event.stopPropagation()
		closeMediaViewer()
	})
	root.querySelector('.media-viewer-download').addEventListener('click', event => {
		event.stopPropagation()
		const item = list[index]
		const anchor = document.createElement('a')
		anchor.href = item.src
		anchor.download = item.name || 'media'
		anchor.rel = 'noopener'
		anchor.click()
	})
	root.addEventListener('click', event => {
		if (event.target === root || event.target === stage) closeMediaViewer()
	})

	document.addEventListener('keydown', onKey)
	document.body.appendChild(root)
	root.showModal()
	activeViewer = root
	detachActiveViewer = onElementRemoved(root, () => {
		document.removeEventListener('keydown', onKey)
		if (activeViewer !== root) return
		activeViewer = null
		detachActiveViewer = null
	})
	root.addEventListener('close', () => {
		root.remove()
		detachActiveViewer?.()
	}, { once: true })
	paint()
	root.focus()
}

document.head.prepend(Object.assign(document.createElement('style'), {
	textContent: /* css */ `\
.media-viewer.modal {
	z-index: 10000;
	outline: none;
	max-width: 100vw;
	max-height: 100dvh;
}
.media-viewer-panel {
	position: relative;
	width: 100%;
	height: 100%;
	display: flex;
	flex-direction: column;
	background: color-mix(in oklab, var(--color-neutral) 92%, transparent);
	color: var(--color-neutral-content);
}
.media-viewer-toolbar {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 10px 16px;
	background: color-mix(in oklab, var(--color-neutral) 45%, transparent);
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
	font-size: 28px;
}
.media-viewer-prev { left: 12px; }
.media-viewer-next { right: 12px; }
`,
}))
