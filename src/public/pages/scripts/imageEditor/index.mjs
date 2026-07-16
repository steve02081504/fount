/**
 * 浏览器端图片编辑器：裁剪 / 马赛克 / 画笔。纯 canvas，无第三方依赖。
 */

/**
 * @param {File | Blob} file 源图片
 * @param {{ title?: string, cropLabel?: string, mosaicLabel?: string, brushLabel?: string, applyLabel?: string, cancelLabel?: string }} [labels] 文案
 * @returns {Promise<File | null>} 编辑后的文件；取消为 null
 */
export function openImageEditor(file, labels = {}) {
	return new Promise((resolve, reject) => {
		const objectUrl = URL.createObjectURL(file)
		const dialog = document.createElement('dialog')
		dialog.className = 'modal image-editor-modal'
		dialog.innerHTML = `
			<div class="modal-box image-editor-box">
				<h3 class="font-bold text-lg">${labels.title || 'Edit image'}</h3>
				<div class="image-editor-toolbar">
					<button type="button" class="btn btn-sm" data-tool="crop">${labels.cropLabel || 'Crop'}</button>
					<button type="button" class="btn btn-sm" data-tool="mosaic">${labels.mosaicLabel || 'Mosaic'}</button>
					<button type="button" class="btn btn-sm" data-tool="brush">${labels.brushLabel || 'Brush'}</button>
					<input type="color" data-brush-color value="#ff0000" title="brush color" />
					<input type="range" min="2" max="48" value="12" data-brush-size title="brush size" />
				</div>
				<div class="image-editor-canvas-wrap">
					<canvas></canvas>
				</div>
				<div class="modal-action">
					<button type="button" class="btn" data-cancel>${labels.cancelLabel || 'Cancel'}</button>
					<button type="button" class="btn btn-primary" data-apply>${labels.applyLabel || 'Apply'}</button>
				</div>
			</div>
			<form method="dialog" class="modal-backdrop"><button>close</button></form>
		`
		document.body.appendChild(dialog)
		const canvas = dialog.querySelector('canvas')
		if (!(canvas instanceof HTMLCanvasElement)) {
			URL.revokeObjectURL(objectUrl)
			dialog.remove()
			reject(new Error('canvas missing'))
			return
		}
		const ctx = canvas.getContext('2d')
		const img = new Image()
		/** @type {'crop' | 'mosaic' | 'brush'} */
		let tool = 'crop'
		let brushColor = '#ff0000'
		let brushSize = 12
		let drawing = false
		let cropStart = null
		let cropRect = null

		/**
		 * @param {File | null} result 编辑结果；取消或加载失败为 null
		 * @returns {void}
		 */
		function finish(result) {
			URL.revokeObjectURL(objectUrl)
			dialog.close()
			dialog.remove()
			resolve(result)
		}

		/**
		 * @returns {void} 图片加载完成后缩放并展示编辑器
		 */
		img.onload = () => {
			const maxW = Math.min(960, img.naturalWidth)
			const scale = maxW / img.naturalWidth
			canvas.width = Math.round(img.naturalWidth * scale)
			canvas.height = Math.round(img.naturalHeight * scale)
			ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
			dialog.showModal()
		}
		/** @returns {void} */
		img.onerror = () => finish(null)
		img.src = objectUrl

		dialog.querySelectorAll('[data-tool]').forEach(btn => {
			btn.addEventListener('click', () => {
				tool = /** @type {'crop' | 'mosaic' | 'brush'} */ (btn.getAttribute('data-tool') || 'crop')
				dialog.querySelectorAll('[data-tool]').forEach(node => node.classList.toggle('btn-active', node === btn))
			})
		})
		dialog.querySelector('[data-brush-color]')?.addEventListener('input', event => {
			brushColor = /** @type {HTMLInputElement} */ event.target.value
		})
		dialog.querySelector('[data-brush-size]')?.addEventListener('input', event => {
			brushSize = Number(/** @type {HTMLInputElement} */ event.target.value) || 12
		})
		dialog.querySelector('[data-cancel]')?.addEventListener('click', () => finish(null))
		dialog.querySelector('[data-apply]')?.addEventListener('click', () => {
			if (tool === 'crop' && cropRect && cropRect.w > 4 && cropRect.h > 4) {
				const tmp = document.createElement('canvas')
				tmp.width = Math.round(cropRect.w)
				tmp.height = Math.round(cropRect.h)
				tmp.getContext('2d').drawImage(
					canvas,
					Math.round(cropRect.x), Math.round(cropRect.y), Math.round(cropRect.w), Math.round(cropRect.h),
					0, 0, tmp.width, tmp.height,
				)
				tmp.toBlob(blob => {
					if (!blob) {
						finish(null)
						return
					}
					const name = file instanceof File ? file.name : 'edited.png'
					finish(new File([blob], name, { type: blob.type || 'image/png' }))
				}, 'image/png')
				return
			}
			canvas.toBlob(blob => {
				if (!blob) {
					finish(null)
					return
				}
				const name = file instanceof File ? file.name : 'edited.png'
				finish(new File([blob], name, { type: blob.type || file.type || 'image/png' }))
			}, file.type || 'image/png')
		})
		dialog.addEventListener('cancel', () => finish(null), { once: true })

		/**
		 * @param {PointerEvent} event 事件
		 * @returns {{ x: number, y: number }} 画布坐标
		 */
		function point(event) {
			const rect = canvas.getBoundingClientRect()
			return {
				x: (event.clientX - rect.left) * (canvas.width / rect.width),
				y: (event.clientY - rect.top) * (canvas.height / rect.height),
			}
		}

		/**
		 * @param {number} x 中心 x
		 * @param {number} y 中心 y
		 * @returns {void}
		 */
		function stampMosaic(x, y) {
			const size = Math.max(8, brushSize)
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
			drawing = true
			canvas.setPointerCapture(event.pointerId)
			const p = point(event)
			if (tool === 'crop') {
				cropStart = p
				cropRect = { x: p.x, y: p.y, w: 0, h: 0 }
			}
			else if (tool === 'mosaic') stampMosaic(p.x, p.y)
			else if (tool === 'brush') {
				ctx.strokeStyle = brushColor
				ctx.lineWidth = brushSize
				ctx.lineCap = 'round'
				ctx.beginPath()
				ctx.moveTo(p.x, p.y)
			}
		})
		canvas.addEventListener('pointermove', event => {
			if (!drawing) return
			const p = point(event)
			if (tool === 'crop' && cropStart) 
				cropRect = {
					x: Math.min(cropStart.x, p.x),
					y: Math.min(cropStart.y, p.y),
					w: Math.abs(p.x - cropStart.x),
					h: Math.abs(p.y - cropStart.y),
				}
			
			else if (tool === 'mosaic') stampMosaic(p.x, p.y)
			else if (tool === 'brush') {
				ctx.lineTo(p.x, p.y)
				ctx.stroke()
			}
		})
		canvas.addEventListener('pointerup', () => {
			drawing = false
		})
	})
}
