/**
 * 共享 sticker picker：消费 registries.sticker 提供商（停靠 / 浮动两种模式）。
 *
 * 选中契约：
 * - 停靠（mountDockedStickerPicker）：onSelect({ stickerId, stickerUrl })，供 Hub 等用 URL fetch 贴纸载荷。
 * - 浮动（mountStickerPicker / wireStickerPickerButton）：onInsert(token)，经 provider.tokenForSelection 生成编辑器 token。
 */
import { importRegistryModules } from '../api/registries.mjs'

import { positionFloatingPanel, wireOutsideClickClose } from './floatingPanel.mjs'

/**
 * @returns {Promise<object | null>} 首个可用 sticker 提供商
 */
async function resolveStickerProvider() {
	const modules = await importRegistryModules('sticker')
	for (const { module } of modules) {
		const provider = module?.default ?? module
		if (provider?.loadStickers)
			return provider
	}
	return null
}

/**
 * @param {object} provider sticker 提供商
 * @param {object} pickerContext picker 上下文
 * @returns {Promise<{ stickers: object[], showMarketLink?: boolean }>} loadStickers 结果
 */
async function loadProviderStickers(provider, pickerContext) {
	return provider.loadStickers(pickerContext)
}

/**
 * @param {object} sticker 贴纸项
 * @param {object} options 按钮样式与行为
 * @param {string} options.className 按钮 class
 * @param {string} [options.imgClass] 预览图 class
 * @param {boolean} [options.labelFallback] 无预览图时显示 label
 * @param {() => void} [options.onClick] 点击回调
 * @returns {HTMLButtonElement} 贴纸按钮
 */
function createStickerButton(sticker, { className, imgClass, labelFallback, onClick }) {
	const button = document.createElement('button')
	button.type = 'button'
	button.className = className
	button.dataset.stickerId = sticker.stickerId
	button.dataset.stickerUrl = sticker.stickerUrl
	button.title = sticker.label
	if (sticker.previewUrl) {
		const img = document.createElement('img')
		img.src = sticker.previewUrl
		img.alt = sticker.label
		img.loading = 'lazy'
		if (imgClass) img.className = imgClass
		button.appendChild(img)
	}
	else if (labelFallback)
		button.textContent = sticker.label || '?'
	if (onClick)
		button.addEventListener('click', onClick)
	return button
}

/**
 * @param {HTMLElement} grid 网格容器
 * @param {object} sticker 贴纸项
 * @returns {void}
 */
function appendStickerGridItem(grid, sticker) {
	grid.appendChild(createStickerButton(sticker, { className: 'sticker-item' }))
}

/**
 * @typedef {object} DockedStickerPickerOptions
 * @property {HTMLElement} pickerElement
 * @property {HTMLElement} gridElement
 * @property {HTMLElement} triggerButton
 * @property {object} [context]
 * @property {(sticker: { stickerId: string, stickerUrl: string }) => Promise<void>} onSelect
 * @property {HTMLElement} [closeWhenOpening]
 */

/**
 * @param {DockedStickerPickerOptions} options 停靠式选择器选项
 * @returns {Promise<null | { reload: () => Promise<void> }>} 控制器或 null（无提供商）
 */
export async function mountDockedStickerPicker(options) {
	const { pickerElement, gridElement, triggerButton, context: pickerContext = {}, onSelect, closeWhenOpening } = options
	const provider = await resolveStickerProvider()
	if (!provider) return null

	let hasLoadedStickers = false

	/**
	 * @returns {Promise<void>}
	 */
	async function reload() {
		gridElement.replaceChildren()
		try {
			const result = await loadProviderStickers(provider, pickerContext)
			if (!result.stickers.length) {
				const empty = document.createElement('div')
				empty.className = 'sticker-empty'
				empty.dataset.i18n = result.showMarketLink
					? 'chat.hub.stickersEmptyWithMarket'
					: 'chat.hub.stickersEmpty'
				gridElement.appendChild(empty)
				hasLoadedStickers = true
				return
			}

			for (const sticker of result.stickers)
				appendStickerGridItem(gridElement, sticker)
			hasLoadedStickers = true
		}
		catch (err) {
			hasLoadedStickers = false
			const fail = document.createElement('div')
			fail.className = 'sticker-load-failed'
			fail.textContent = err?.message || 'load failed'
			gridElement.appendChild(fail)
		}
	}

	triggerButton.addEventListener('click', event => {
		event.stopPropagation()
		closeWhenOpening?.classList.remove('show')
		pickerElement.classList.toggle('show')
		if (pickerElement.classList.contains('show') && !hasLoadedStickers)
			void reload()
	})

	gridElement.addEventListener('click', event => {
		const stickerItem = event.target.closest('.sticker-item')
		if (!stickerItem) return
		const sticker = {
			stickerId: stickerItem.dataset.stickerId,
			stickerUrl: stickerItem.dataset.stickerUrl,
		}
		pickerElement.classList.remove('show')
		void onSelect(sticker)
	})

	document.addEventListener('click', event => {
		if (pickerElement.classList.contains('show')
			&& !pickerElement.contains(event.target)
			&& !triggerButton.contains(event.target))
			pickerElement.classList.remove('show')
	})

	return { reload }
}

/**
 * @param {object} [pickerContext] picker 上下文
 * @returns {Promise<Array<{ label: string, previewUrl?: string, raw: object, provider: object }>>} 扁平贴纸条目
 */
export async function loadStickerPickItems(pickerContext = {}) {
	const provider = await resolveStickerProvider()
	if (!provider) return []
	const result = await loadProviderStickers(provider, pickerContext)
	return result.stickers.map(sticker => ({
		label: sticker.label,
		previewUrl: sticker.previewUrl,
		raw: sticker,
		provider,
	}))
}

/**
 * @param {HTMLElement} anchor 定位锚点
 * @param {(text: string) => void} onInsert 选中后插入回调（provider.tokenForSelection 生成的 token）
 * @param {object} [pickerContext] picker 上下文
 * @returns {Promise<void>}
 */
export async function mountStickerPicker(anchor, onInsert, pickerContext = {}) {
	document.getElementById('fount-shared-sticker-picker')?.remove()
	const items = await loadStickerPickItems(pickerContext)
	const panel = document.createElement('div')
	panel.id = 'fount-shared-sticker-picker'
	panel.className = 'fount-sticker-picker card shadow-lg'
	panel.style.cssText = 'position:fixed;z-index:10000;max-width:360px;max-height:280px;overflow:auto;padding:8px;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;'
	positionFloatingPanel(panel, anchor, { panelWidth: 360, heightOffset: 290 })

	if (!items.length) {
		const empty = document.createElement('div')
		empty.className = 'sticker-empty'
		empty.dataset.i18n = 'chat.hub.stickersEmpty'
		panel.appendChild(empty)
	}
	else for (const item of items)
		panel.appendChild(createStickerButton(item.raw, {
			className: 'btn btn-ghost p-1',
			imgClass: 'w-16 h-16 object-contain',
			labelFallback: true,
			/**
			 * 点击回调
			 */
			onClick: () => {
				const token = item.provider.tokenForSelection(item.raw, pickerContext)
				if (token) onInsert(token)
				panel.remove()
			},
		}))

	document.body.appendChild(panel)
	wireOutsideClickClose(panel, () => panel.remove())
}

/**
 * @param {HTMLElement} button 触发按钮
 * @param {(text: string) => void} onInsert 选中后插入回调（provider.tokenForSelection 生成的 token）
 * @param {object} [pickerContext] picker 上下文
 * @returns {void}
 */
export function wireStickerPickerButton(button, onInsert, pickerContext = {}) {
	button.addEventListener('click', e => {
		e.preventDefault()
		void mountStickerPicker(button, onInsert, pickerContext)
	})
}
