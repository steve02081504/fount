/**
 * 浏览器端图片编辑器：裁剪 / 马赛克 / 画笔。纯 canvas，无第三方依赖。
 * 画布按原始分辨率工作，仅用 CSS 缩放显示，导出不降采样。
 */

import { showToastI18n } from '../features/toast.mjs'
import { escapeHtml } from '../lib/escapeHtml.mjs'

/** canvas.toBlob 能按源类型导出的 MIME。 */
const EXPORTABLE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

/** 撤销/重做历史的最大步数。 */
const HISTORY_LIMIT = 30

/**
 * @param {number} value 数值
 * @param {number} min 下界
 * @param {number} max 上界
 * @returns {number} 夹取后的数值
 */
function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value))
}

/**
 * @param {File | Blob} file 源图片
 * @param {{ titleI18n?: string, cropI18n?: string, mosaicI18n?: string, brushI18n?: string, brushColorI18n?: string, brushSizeI18n?: string, undoI18n?: string, redoI18n?: string, resetI18n?: string, applyI18n?: string, cancelI18n?: string, loadFailedI18n?: string, exportFailedI18n?: string }} [labels] 文案键（默认 `util.imageEditor.*` / `util.common.cancel`）
 * @returns {Promise<File | null>} 编辑后的文件；取消为 null
 */
export function openImageEditor(file, labels = {}) {
	return new Promise((resolve, reject) => {
		const objectUrl = URL.createObjectURL(file)
		const titleId = `image-editor-title-${Math.random().toString(36).slice(2, 8)}`
		const dialog = document.createElement('dialog')
		dialog.className = 'modal image-editor-modal'
		dialog.setAttribute('aria-labelledby', titleId)
		dialog.innerHTML = `\
<div class="modal-box w-full max-w-[min(96vw,980px)]">
	<h2 id="${titleId}" class="font-bold text-lg" data-i18n="${escapeHtml(labels.titleI18n || 'util.imageEditor.image')}"></h2>
	<div class="flex flex-wrap gap-2 items-center my-3">
		<button type="button" class="btn btn-sm" data-tool="crop" data-i18n="${escapeHtml(labels.cropI18n || 'util.imageEditor.crop')}"></button>
		<button type="button" class="btn btn-sm" data-tool="mosaic" data-i18n="${escapeHtml(labels.mosaicI18n || 'util.imageEditor.mosaic')}"></button>
		<button type="button" class="btn btn-sm" data-tool="brush" data-i18n="${escapeHtml(labels.brushI18n || 'util.imageEditor.brush')}"></button>
		<input type="color" data-brush-color value="#ff0000" data-i18n="${escapeHtml(labels.brushColorI18n || 'util.imageEditor.brushColor')}" />
		<input type="range" min="2" max="48" value="12" data-brush-size data-i18n="${escapeHtml(labels.brushSizeI18n || 'util.imageEditor.brushSize')}" />
		<span class="flex-1"></span>
		<button type="button" class="btn btn-sm" data-undo data-i18n="${escapeHtml(labels.undoI18n || 'util.imageEditor.undo')}" disabled></button>
		<button type="button" class="btn btn-sm" data-redo data-i18n="${escapeHtml(labels.redoI18n || 'util.imageEditor.redo')}" disabled></button>
		<button type="button" class="btn btn-sm" data-reset data-i18n="${escapeHtml(labels.resetI18n || 'util.imageEditor.reset')}"></button>
	</div>
	<div class="overflow-auto max-h-[70vh] border border-base-300 rounded-box">
		<div class="image-editor-stage">
			<canvas data-editor-canvas></canvas>
			<canvas class="image-editor-overlay"></canvas>
		</div>
	</div>
	<div class="modal-action">
		<button type="button" class="btn" data-cancel data-i18n="${escapeHtml(labels.cancelI18n || 'util.common.cancel')}"></button>
		<button type="button" class="btn btn-primary" data-apply data-i18n="${escapeHtml(labels.applyI18n || 'util.imageEditor.apply')}"></button>
	</div>
</div>
<form method="dialog" class="modal-backdrop"><button>close</button></form>
`
		document.body.appendChild(dialog)
		const canvas = dialog.querySelector('[data-editor-canvas]')
		const overlay = dialog.querySelector('.image-editor-overlay')
		if (!(canvas instanceof HTMLCanvasElement) || !(overlay instanceof HTMLCanvasElement)) {
			URL.revokeObjectURL(objectUrl)
			dialog.remove()
			reject(new Error('canvas missing'))
			return
		}
		const ctx = canvas.getContext('2d')
		const overlayCtx = overlay.getContext('2d')
		const img = new Image()
		const outputType = EXPORTABLE_TYPES.has(file.type) ? file.type : 'image/png'
		/** @type {'crop' | 'mosaic' | 'brush'} */
		let tool = 'crop'
		let brushColor = '#ff0000'
		let brushSize = 12
		let drawing = false
		let cropStart = null
		/** @type {{ x: number, y: number, w: number, h: number } | null} */
		let cropRect = null
		let initialDataUrl = null
		let settled = false
		/** @type {string[]} */
		const undoStack = []
		/** @type {string[]} */
		const redoStack = []
		const resizeObserver = new ResizeObserver(() => syncOverlay())
		resizeObserver.observe(canvas)

		/**
		 * @param {File | null} result 编辑结果；取消或加载失败为 null
		 * @returns {void}
		 */
		function finish(result) {
			if (settled) return
			settled = true
			resizeObserver.disconnect()
			URL.revokeObjectURL(objectUrl)
			if (dialog.open) dialog.close()
			dialog.remove()
			resolve(result)
		}

		/**
		 * @returns {void} 重绘裁剪遮罩层
		 */
		function drawCropOverlay() {
			if (!overlayCtx) return
			const width = overlay.width
			const height = overlay.height
			overlayCtx.clearRect(0, 0, width, height)
			if (!cropRect || !width || !height) return
			const scale = width / canvas.width
			const x = cropRect.x * scale
			const y = cropRect.y * scale
			const w = cropRect.w * scale
			const h = cropRect.h * scale
			if (w < 0.5 || h < 0.5) return
			overlayCtx.fillStyle = 'rgba(0, 0, 0, 0.55)'
			overlayCtx.fillRect(0, 0, width, height)
			overlayCtx.clearRect(x, y, w, h)
			overlayCtx.strokeStyle = 'rgba(255, 255, 255, 0.95)'
			overlayCtx.lineWidth = 1
			overlayCtx.setLineDash([5, 4])
			overlayCtx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1))
			overlayCtx.setLineDash([])
		}

		/**
		 * @returns {void} 同步遮罩层像素尺寸到画布的显示尺寸
		 */
		function syncOverlay() {
			const width = canvas.clientWidth
			const height = canvas.clientHeight
			if (width && height) {
				if (overlay.width !== width) overlay.width = width
				if (overlay.height !== height) overlay.height = height
			}
			drawCropOverlay()
		}

		/**
		 * @returns {void} 刷新撤销/重做按钮可用态
		 */
		function updateHistoryButtons() {
			const undoButton = dialog.querySelector('[data-undo]')
			const redoButton = dialog.querySelector('[data-redo]')
			undoButton.disabled = !undoStack.length
			redoButton.disabled = !redoStack.length
		}

		/**
		 * @returns {string} 当前画布状态的 PNG 数据 URL
		 */
		function snapshot() {
			return canvas.toDataURL('image/png')
		}

		/**
		 * @param {string} dataUrl PNG 数据 URL
		 * @returns {Promise<void>}
		 */
		function restore(dataUrl) {
			return new Promise((restoreResolve, restoreReject) => {
				const image = new Image()
				/** 历史快照解码完成后写回画布。 */
				image.onload = () => {
					ctx.clearRect(0, 0, canvas.width, canvas.height)
					ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
					restoreResolve()
				}
				/** 历史快照解码失败时拒绝。 */
				image.onerror = () => { restoreReject(new Error('restore failed')) }
				image.src = dataUrl
			})
		}

		/**
		 * @returns {void} 记录一次改动前的画布状态
		 */
		function pushHistory() {
			undoStack.push(snapshot())
			if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
			redoStack.length = 0
			updateHistoryButtons()
		}

		/**
		 * @returns {Promise<void>} 撤销一步
		 */
		async function undo() {
			if (!undoStack.length) return
			redoStack.push(snapshot())
			await restore(undoStack.pop())
			cropRect = null
			drawCropOverlay()
			updateHistoryButtons()
		}

		/**
		 * @returns {Promise<void>} 重做一步
		 */
		async function redo() {
			if (!redoStack.length) return
			undoStack.push(snapshot())
			await restore(redoStack.pop())
			cropRect = null
			drawCropOverlay()
			updateHistoryButtons()
		}

		/**
		 * @returns {Promise<void>} 恢复到刚加载时的状态
		 */
		async function reset() {
			if (!initialDataUrl) return
			pushHistory()
			await restore(initialDataUrl)
			cropRect = null
			drawCropOverlay()
		}

		/**
		 * @param {HTMLButtonElement} button 工具按钮
		 * @returns {void}
		 */
		function setTool(button) {
			tool = /** @type {'crop' | 'mosaic' | 'brush'} */ (button.getAttribute('data-tool') || 'crop')
			dialog.querySelectorAll('[data-tool]').forEach(node => node.classList.toggle('btn-active', node === button))
		}

		/**
		 * @returns {void} 图片加载完成后按原始分辨率展示编辑器
		 */
		img.onload = () => {
			if (!img.naturalWidth || !img.naturalHeight) {
				showToastI18n('error', labels.loadFailedI18n || 'util.imageEditor.loadFailed')
				finish(null)
				return
			}
			canvas.width = img.naturalWidth
			canvas.height = img.naturalHeight
			ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
			initialDataUrl = snapshot()
			updateHistoryButtons()
			dialog.showModal()
			requestAnimationFrame(syncOverlay)
		}
		/**
		 * @returns {void} 加载失败时提示并取消
		 */
		img.onerror = () => {
			showToastI18n('error', labels.loadFailedI18n || 'util.imageEditor.loadFailed')
			finish(null)
		}
		img.src = objectUrl

		const initialTool = dialog.querySelector('[data-tool="crop"]')
		if (initialTool) setTool(initialTool)

		dialog.querySelectorAll('[data-tool]').forEach(button => {
			button.addEventListener('click', () => setTool(/** @type {HTMLButtonElement} */ button))
		})
		dialog.querySelector('[data-brush-color]')?.addEventListener('input', event => {
			brushColor = /** @type {HTMLInputElement} */ event.target.value
		})
		dialog.querySelector('[data-brush-size]')?.addEventListener('input', event => {
			brushSize = Number(/** @type {HTMLInputElement} */ event.target.value) || 12
		})
		dialog.querySelector('[data-undo]')?.addEventListener('click', () => { undo().catch(error => console.error(error)) })
		dialog.querySelector('[data-redo]')?.addEventListener('click', () => { redo().catch(error => console.error(error)) })
		dialog.querySelector('[data-reset]')?.addEventListener('click', () => { reset().catch(error => console.error(error)) })
		dialog.querySelector('[data-cancel]')?.addEventListener('click', () => finish(null))

		/**
		 * @returns {Promise<Blob | null>} 按导出类型编码，必要时裁剪
		 */
		function exportBlob() {
			const crop = cropRect && cropRect.w > 4 && cropRect.h > 4 ? cropRect : null
			const width = crop ? Math.max(1, Math.round(crop.w)) : canvas.width
			const height = crop ? Math.max(1, Math.round(crop.h)) : canvas.height
			let source = canvas
			if (crop) {
				const tmp = document.createElement('canvas')
				tmp.width = width
				tmp.height = height
				const tmpCtx = tmp.getContext('2d')
				if (outputType === 'image/jpeg') {
					tmpCtx.fillStyle = '#ffffff'
					tmpCtx.fillRect(0, 0, width, height)
				}
				tmpCtx.drawImage(
					canvas,
					Math.round(crop.x), Math.round(crop.y), width, height,
					0, 0, width, height,
				)
				source = tmp
			}
			return new Promise(blobResolve => source.toBlob(blobResolve, outputType))
		}

		dialog.querySelector('[data-apply]')?.addEventListener('click', async () => {
			try {
				const blob = await exportBlob()
				if (!blob) {
					showToastI18n('error', labels.exportFailedI18n || 'util.imageEditor.exportFailed')
					return
				}
				const name = file instanceof File ? file.name : 'edited.png'
				finish(new File([blob], name, { type: blob.type || outputType }))
			}
			catch (error) {
				console.error(error)
				showToastI18n('error', labels.exportFailedI18n || 'util.imageEditor.exportFailed')
			}
		})
		dialog.addEventListener('cancel', () => finish(null), { once: true })
		dialog.addEventListener('close', () => finish(null), { once: true })

		/**
		 * @param {PointerEvent} event 事件
		 * @returns {{ x: number, y: number }} 画布自然坐标
		 */
		function point(event) {
			const rect = canvas.getBoundingClientRect()
			return {
				x: (event.clientX - rect.left) * (canvas.width / rect.width),
				y: (event.clientY - rect.top) * (canvas.height / rect.height),
			}
		}

		/**
		 * @returns {number} 以画布自然像素表示的当前画笔粗细
		 */
		function canvasBrushSize() {
			const rect = canvas.getBoundingClientRect()
			return Math.max(1, brushSize * (rect.width ? canvas.width / rect.width : 1))
		}

		/**
		 * @param {number} x 中心 x
		 * @param {number} y 中心 y
		 * @returns {void}
		 */
		function stampMosaic(x, y) {
			const size = Math.max(8, canvasBrushSize())
			const sx = Math.max(0, Math.floor(x - size / 2))
			const sy = Math.max(0, Math.floor(y - size / 2))
			const sw = Math.min(size, canvas.width - sx)
			const sh = Math.min(size, canvas.height - sy)
			if (sw <= 0 || sh <= 0) return
			const sample = ctx.getImageData(sx, sy, sw, sh)
			let r = 0; let g = 0; let b = 0; let a = 0; let n = 0
			for (let i = 0; i < sample.data.length; i += 4) {
				r += sample.data[i]
				g += sample.data[i + 1]
				b += sample.data[i + 2]
				a += sample.data[i + 3]
				n++
			}
			if (!n) return
			ctx.fillStyle = `rgba(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)},${a / n / 255})`
			ctx.fillRect(sx, sy, sw, sh)
		}

		canvas.addEventListener('pointerdown', event => {
			if (event.pointerType === 'mouse' && event.button !== 0) return
			event.preventDefault()
			drawing = true
			try { canvas.setPointerCapture(event.pointerId) } catch { /* 合成事件无活动指针 */ }
			const p = point(event)
			if (tool === 'crop') {
				cropStart = p
				cropRect = { x: p.x, y: p.y, w: 0, h: 0 }
				drawCropOverlay()
			}
			else if (tool === 'mosaic') {
				pushHistory()
				stampMosaic(p.x, p.y)
			}
			else {
				pushHistory()
				ctx.strokeStyle = brushColor
				ctx.lineWidth = canvasBrushSize()
				ctx.lineCap = 'round'
				ctx.lineJoin = 'round'
				ctx.beginPath()
				ctx.moveTo(p.x, p.y)
			}
		})
		canvas.addEventListener('pointermove', event => {
			if (!drawing) return
			const p = point(event)
			if (tool === 'crop') {
				if (!cropStart) return
				const left = clamp(Math.min(cropStart.x, p.x), 0, canvas.width)
				const top = clamp(Math.min(cropStart.y, p.y), 0, canvas.height)
				const right = clamp(Math.max(cropStart.x, p.x), 0, canvas.width)
				const bottom = clamp(Math.max(cropStart.y, p.y), 0, canvas.height)
				cropRect = { x: left, y: top, w: right - left, h: bottom - top }
				drawCropOverlay()
			}
			else if (tool === 'mosaic') stampMosaic(p.x, p.y)
			else {
				ctx.lineTo(p.x, p.y)
				ctx.stroke()
			}
		})
		/**
		 * @returns {void} 结束当前笔触/框选
		 */
		function endStroke() {
			if (!drawing) return
			drawing = false
			cropStart = null
		}
		canvas.addEventListener('pointerup', endStroke)
		canvas.addEventListener('pointercancel', endStroke)
		canvas.addEventListener('lostpointercapture', endStroke)
	})
}

// --- 全局样式注入 ---

document.head.prepend(Object.assign(document.createElement('style'), {
	textContent: /* css */ `\
.image-editor-stage {
	position: relative;
	display: inline-block;
	max-width: 100%;
}
.image-editor-stage [data-editor-canvas] {
	display: block;
	max-width: 100%;
	height: auto;
	cursor: crosshair;
	touch-action: none;
}
.image-editor-overlay {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	pointer-events: none;
}
`,
}))
