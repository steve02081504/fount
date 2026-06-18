/**
 * 共享 sticker picker：消费 registries.sticker 提供商（停靠 / 浮动两种模式）。
 */
/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns-description, jsdoc/require-returns, jsdoc/require-param-type */
import { importRegistryModules } from './registries.mjs'

/**
 * @param {string} s
 * @returns {string}
 */
function escapeHtml(s) {
	return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

/**
 * @param {object} [ctx]
 * @returns {Promise<object | null>}
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
 * @param {HTMLElement} grid
 * @param {object} sticker
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
 * @param {DockedStickerPickerOptions} options
 * @returns {Promise<null | { reload: () => Promise<void> }>}
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
 * @param {object} [ctx]
 * @returns {Promise<Array<{ label: string, previewUrl?: string, raw: object, provider: object }>>}
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
 * @param {HTMLElement} anchor
 * @param {(text: string) => void} onInsert
 * @param {object} [ctx]
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
		 * @param {Event} e
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
 * @param {HTMLElement} button
 * @param {(text: string) => void} onInsert
 * @param {object} [ctx]
 * @returns {void}
 */
export function wireStickerPickerButton(button, onInsert, ctx = {}) {
	if (!(button instanceof HTMLElement)) return
	button.addEventListener('click', e => {
		e.preventDefault()
		void mountStickerPicker(button, onInsert, ctx)
	})
}
