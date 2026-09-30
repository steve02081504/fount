/**
 * imageEditor 契约：画布按原始分辨率工作（导出不降采样）、裁剪取 crop 矩形而非当前工具、
 * 撤销能恢复改动前的画布状态。
 */
import { test, expect } from './fixtures.mjs'

test('apply preserves the natural resolution', async ({ modulePage }) => {
	const result = await modulePage.run(async () => {
		const source = document.createElement('canvas')
		source.width = 1000
		source.height = 500
		const sourceContext = source.getContext('2d')
		sourceContext.fillStyle = '#3366cc'
		sourceContext.fillRect(0, 0, source.width, source.height)
		const blob = await new Promise(resolve => source.toBlob(resolve, 'image/png'))
		const file = new File([blob], 'big.png', { type: 'image/png' })

		const { openImageEditor } = await import('/scripts/components/imageEditor.mjs')
		const promise = openImageEditor(file)
		const dialog = await (async () => {
			const start = Date.now()
			while (Date.now() - start < 8000) {
				const node = document.querySelector('dialog.image-editor-modal')
				if (node?.open) return node
				await new Promise(resolve => setTimeout(resolve, 10))
			}
			throw new Error('dialog did not open')
		})()
		dialog.querySelector('[data-apply]').click()
		const edited = await promise

		const url = URL.createObjectURL(edited)
		const image = new Image()
		await new Promise((resolve, reject) => {
			image.onload = resolve
			image.onerror = reject
			image.src = url
		})
		const dimensions = { width: image.naturalWidth, height: image.naturalHeight, type: edited.type }
		URL.revokeObjectURL(url)
		return dimensions
	})

	expect(result.width).toBe(1000)
	expect(result.height).toBe(500)
	expect(result.type).toBe('image/png')
})

test('crop follows the crop rectangle regardless of the selected tool', async ({ modulePage }) => {
	const result = await modulePage.run(async () => {
		const source = document.createElement('canvas')
		source.width = 200
		source.height = 100
		const sourceContext = source.getContext('2d')
		sourceContext.fillStyle = '#22aa44'
		sourceContext.fillRect(0, 0, source.width, source.height)
		const blob = await new Promise(resolve => source.toBlob(resolve, 'image/png'))
		const file = new File([blob], 'crop.png', { type: 'image/png' })

		const { openImageEditor } = await import('/scripts/components/imageEditor.mjs')
		const promise = openImageEditor(file)
		const start = Date.now()
		let dialog
		while (Date.now() - start < 8000) {
			const node = document.querySelector('dialog.image-editor-modal')
			if (node?.open) { dialog = node; break }
			await new Promise(resolve => setTimeout(resolve, 10))
		}
		const canvas = dialog.querySelector('[data-editor-canvas]')
		const rect = canvas.getBoundingClientRect()
		/**
		 * 在画布上派发合成指针事件。
		 * @param {string} type 事件类型
		 * @param {number} x 画布内 x
		 * @param {number} y 画布内 y
		 * @returns {void} 无返回值
		 */
		const dispatch = (type, x, y) => {
			canvas.dispatchEvent(new PointerEvent(type, {
				bubbles: true,
				cancelable: true,
				composed: true,
				pointerId: 1,
				pointerType: 'mouse',
				isPrimary: true,
				button: 0,
				buttons: type === 'pointerup' ? 0 : 1,
				clientX: rect.left + x,
				clientY: rect.top + y,
			}))
		}

		dispatch('pointerdown', 20, 10)
		dispatch('pointermove', 120, 90)
		dispatch('pointerup', 120, 90)
		dialog.querySelector('[data-tool="brush"]').click()
		dialog.querySelector('[data-apply]').click()
		const edited = await promise

		const url = URL.createObjectURL(edited)
		const image = new Image()
		await new Promise((resolve, reject) => {
			image.onload = resolve
			image.onerror = reject
			image.src = url
		})
		const dimensions = { width: image.naturalWidth, height: image.naturalHeight }
		URL.revokeObjectURL(url)
		return dimensions
	})

	expect(result.width).toBe(100)
	expect(result.height).toBe(80)
})

test('undo restores the canvas state before the edit', async ({ modulePage }) => {
	const result = await modulePage.run(async () => {
		const source = document.createElement('canvas')
		source.width = 64
		source.height = 64
		const sourceContext = source.getContext('2d')
		sourceContext.fillStyle = '#0000ff'
		sourceContext.fillRect(0, 0, source.width, source.height)
		const blob = await new Promise(resolve => source.toBlob(resolve, 'image/png'))
		const file = new File([blob], 'pixel.png', { type: 'image/png' })

		const { openImageEditor } = await import('/scripts/components/imageEditor.mjs')
		const promise = openImageEditor(file)
		const start = Date.now()
		let dialog
		while (Date.now() - start < 8000) {
			const node = document.querySelector('dialog.image-editor-modal')
			if (node?.open) { dialog = node; break }
			await new Promise(resolve => setTimeout(resolve, 10))
		}
		const canvas = dialog.querySelector('[data-editor-canvas]')
		const rect = canvas.getBoundingClientRect()
		/**
		 * 读取画布中心像素。
		 * @returns {number[]} RGBA 分量
		 */
		const readCenter = () => Array.from(canvas.getContext('2d').getImageData(32, 32, 1, 1).data)
		const before = readCenter()
		/**
		 * 在画布上派发合成指针事件。
		 * @param {string} type 事件类型
		 * @param {number} x 画布内 x
		 * @param {number} y 画布内 y
		 * @returns {void} 无返回值
		 */
		const dispatch = (type, x, y) => {
			canvas.dispatchEvent(new PointerEvent(type, {
				bubbles: true,
				cancelable: true,
				composed: true,
				pointerId: 1,
				pointerType: 'mouse',
				isPrimary: true,
				button: 0,
				buttons: type === 'pointerup' ? 0 : 1,
				clientX: rect.left + x,
				clientY: rect.top + y,
			}))
		}

		dialog.querySelector('[data-tool="brush"]').click()
		dispatch('pointerdown', 20, 32)
		dispatch('pointermove', 32, 32)
		dispatch('pointermove', 44, 32)
		dispatch('pointerup', 44, 32)
		const painted = readCenter()
		dialog.querySelector('[data-undo]').click()
		const undoneStart = Date.now()
		while (Date.now() - undoneStart < 8000) {
			const pixel = readCenter()
			if (pixel[2] > 200 && pixel[0] < 60) break
			await new Promise(resolve => setTimeout(resolve, 10))
		}
		const undone = readCenter()
		dialog.querySelector('[data-apply]').click()
		await promise

		return { before, painted, undone }
	})

	expect(result.before[2]).toBeGreaterThan(200)
	expect(result.before[0]).toBeLessThan(60)
	expect(result.painted[0]).toBeGreaterThan(200)
	expect(result.painted[2]).toBeLessThan(60)
	expect(result.undone[2]).toBeGreaterThan(200)
	expect(result.undone[0]).toBeLessThan(60)
})
