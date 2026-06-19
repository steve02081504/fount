/**
 * 共享 sticker picker：消费 registries.sticker 提供商（停靠 / 浮动两种模式）。
 */
import { importRegistryModules } from './registries.mjs'

/**
 * @param {string} s 原始文本
 * @returns {string} HTML 转义结果
 */
function escapeHtml(s) {
	return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

/**
 * @param {object} [ctx] picker 上下文
 * @returns {Promise<object | null>} 首个可用 sticker 提供商
 */
async function resolveStickerProvider(ctx) {
	const modules = await importRegistryModules('sticker')
	for (const { module } of modules) {
		const provider = module?.default ?? module
		if (provider?.loadStickers || provider?.listPacks)
			return provider
	}
	return null
}

/**
 * @param {HTMLElement} grid 网格容器
 * @param {object} sticker 贴纸项
 * @returns {void}
 */
function appendStickerGridItem(grid, sticker) {
	const btn = document.createElement('button')
	btn.type = 'button'
	btn.className = 'hub-sticker-item'
	btn.dataset.stickerId = sticker.stickerId || sticker.id
	btn.dataset.stickerUrl = sticker.stickerUrl || sticker.previewUrl || ''
	btn.title = sticker.label || sticker.name || sticker.stickerId || ''
	if (sticker.previewUrl || sticker.stickerUrl) {
		const img = document.createElement('img')
		img.src = sticker.previewUrl || sticker.stickerUrl
		img.alt = sticker.label || ''
		img.loading = 'lazy'
		btn.appendChild(img)
	}
	grid.appendChild(btn)
}

/**
 * @typedef {object} DockedStickerPickerOptions
 * @property {HTMLElement} pickerEl
 * @property {HTMLElement} gridEl
 * @property {HTMLElement} triggerBtn
 * @property {object} [ctx]
 * @property {(sticker: object) => Promise<void>} onSelect
 * @property {HTMLElement} [closeWhenOpening]
 */

/**
 * @param {DockedStickerPickerOptions} options 停靠式选择器选项
 * @returns {Promise<null | { reload: () => Promise<void> }>} 控制器或 null（无提供商）
 */
export async function mountDockedStickerPicker(options) {
	const { pickerEl, gridEl, triggerBtn, ctx = {}, onSelect, closeWhenOpening } = options
	const provider = await resolveStickerProvider(ctx)
	if (!provider) return null

	let loaded = false

	/**
	 * @returns {Promise<void>}
	 */
	async function reload() {
		gridEl.replaceChildren()
		try {
			const result = provider.loadStickers
				? await provider.loadStickers(ctx)
				: { stickers: (await provider.listPacks(ctx))?.[0]?.items || [] }

			const stickers = result.stickers || []
			if (!stickers.length) {
				const empty = document.createElement('div')
				empty.className = 'hub-sticker-empty'
				empty.dataset.i18n = result.showMarketLink
					? 'chat.hub.stickersEmptyWithMarket'
					: 'chat.hub.stickersEmpty'
				gridEl.appendChild(empty)
				return
			}

			for (const sticker of stickers)
				appendStickerGridItem(gridEl, sticker)
		}
		catch (err) {
			loaded = false
			const fail = document.createElement('div')
			fail.className = 'hub-sticker-load-failed'
			fail.textContent = err?.message || 'load failed'
			gridEl.appendChild(fail)
		}
	}

	triggerBtn.addEventListener('click', event => {
		event.stopPropagation()
		closeWhenOpening?.classList.remove('show')
		pickerEl.classList.toggle('show')
		if (pickerEl.classList.contains('show') && !loaded) {
			loaded = true
			void reload()
		}
	})

	gridEl.addEventListener('click', event => {
		const stickerItem = event.target.closest('.hub-sticker-item')
		if (!stickerItem) return
		const sticker = {
			stickerId: stickerItem.dataset.stickerId,
			stickerUrl: stickerItem.dataset.stickerUrl,
		}
		pickerEl.classList.remove('show')
		void onSelect(sticker)
	})

	document.addEventListener('click', event => {
		if (pickerEl.classList.contains('show')
			&& !pickerEl.contains(event.target)
			&& !triggerBtn.contains(event.target))
			pickerEl.classList.remove('show')
	})

	return { reload }
}

/**
 * @param {object} [ctx] picker 上下文
 * @returns {Promise<Array<{ label: string, previewUrl?: string, raw: object, provider: object }>>} 扁平贴纸条目
 */
export async function loadStickerPickItems(ctx = {}) {
	const provider = await resolveStickerProvider(ctx)
	if (!provider) return []
	const result = provider.loadStickers
		? await provider.loadStickers(ctx)
		: { stickers: (await provider.listPacks(ctx))?.[0]?.items || [] }
	return (result.stickers || []).map(sticker => ({
		label: sticker.label || sticker.name || '',
		previewUrl: sticker.previewUrl || sticker.stickerUrl || null,
		raw: sticker,
		provider,
	}))
}

/**
 * @param {HTMLElement} anchor 定位锚点
 * @param {(text: string) => void} onInsert 选中后插入回调
 * @param {object} [ctx] picker 上下文
 * @returns {Promise<void>}
 */
export async function mountStickerPicker(anchor, onInsert, ctx = {}) {
	document.getElementById('fount-shared-sticker-picker')?.remove()
	const items = await loadStickerPickItems(ctx)
	const panel = document.createElement('div')
	panel.id = 'fount-shared-sticker-picker'
	panel.className = 'fount-sticker-picker card shadow-lg'
	panel.style.cssText = 'position:fixed;z-index:10000;max-width:360px;max-height:280px;overflow:auto;padding:8px;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;'
	const rect = anchor.getBoundingClientRect()
	panel.style.left = `${Math.min(rect.left, window.innerWidth - 370)}px`
	panel.style.top = `${Math.max(8, rect.top - 290)}px`

	for (const item of items) {
		const btn = document.createElement('button')
		btn.type = 'button'
		btn.className = 'btn btn-ghost p-1'
		if (item.previewUrl)
			btn.innerHTML = `<img src="${escapeHtml(item.previewUrl)}" alt="" class="w-16 h-16 object-contain" />`
		else
			btn.textContent = item.label || '?'
		btn.addEventListener('click', () => {
			const token = item.provider?.tokenForSelection?.(item.raw, ctx) || ''
			if (token) onInsert(token)
			panel.remove()
		})
		panel.appendChild(btn)
	}

	document.body.appendChild(panel)
	setTimeout(() => {
		/**
		 * @param {Event} e 外部点击事件
		 * @returns {void}
		 */
		const close = e => {
			if (!panel.contains(e.target)) {
				panel.remove()
				document.removeEventListener('click', close, true)
			}
		}
		document.addEventListener('click', close, true)
	}, 0)
}

/**
 * @param {HTMLElement} button 触发按钮
 * @param {(text: string) => void} onInsert 选中后插入回调
 * @param {object} [ctx] picker 上下文
 * @returns {void}
 */
export function wireStickerPickerButton(button, onInsert, ctx = {}) {
	if (!(button instanceof HTMLElement)) return
	button.addEventListener('click', e => {
		e.preventDefault()
		void mountStickerPicker(button, onInsert, ctx)
	})
}
