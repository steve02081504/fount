/**
 * 共享 emoji picker：消费 registries.emoji 提供商（停靠 / 浮动两种模式）。
 */
import { importRegistryModules } from './registries.mjs'
import { escapeHtml } from './escapeHtml.mjs'

const GROUP_EMOJI_LONG_PRESS_MS = 500

/**
 * @param {object} [ctx] picker 上下文
 * @returns {Promise<object | null>} 首个可用 emoji 提供商
 */
async function resolveEmojiProvider(ctx) {
	const modules = await importRegistryModules('emoji')
	for (const { module } of modules) {
		const provider = module?.default ?? module
		if (provider?.listTabs && provider?.loadTabItems)
			return provider
	}
	return null
}

/**
 * @param {HTMLElement} tabsEl 标签容器（未直接使用，保留签名）
 * @param {object} tab 标签页描述
 * @param {object} provider emoji 提供商
 * @param {string | null} activeTabId 当前激活标签 id
 * @returns {HTMLButtonElement} 标签按钮元素
 */
function renderTabButton(tabsEl, tab, provider, activeTabId) {
	const tabButton = document.createElement('button')
	tabButton.type = 'button'
	tabButton.className = 'hub-emoji-tab'
	tabButton.dataset.tab = tab.id
	if (tab.i18nKey) tabButton.dataset.i18n = tab.i18nKey
	if (tab.title) tabButton.title = tab.title
	tabButton.classList.toggle('active', tab.id === activeTabId)

	if (tab.type === 'group' && provider.groupTabInnerHtml)
		tabButton.innerHTML = provider.groupTabInnerHtml(
			{ groupId: tab.groupId, name: tab.title, avatar: tab.avatar },
			!!tab.isCurrent,
		)
	else if (tab.glyph)
		tabButton.innerHTML = `<span class="hub-emoji-tab-glyph" aria-hidden="true">${tab.glyph}</span>`

	return tabButton
}

/**
 * @param {HTMLElement} grid 网格容器
 * @param {object} item emoji 项
 * @returns {void}
 */
function appendEmojiGridItem(grid, item) {
	if (item.kind === 'custom' || (item.groupId && item.emojiId)) {
		const btn = document.createElement('button')
		btn.type = 'button'
		btn.className = 'hub-emoji-grid-button hub-group-emoji-grid-button'
		btn.dataset.groupEmojiId = item.emojiId
		btn.dataset.groupEmojiRef = item.emojiRef || `:[${item.groupId}/${item.emojiId}]:`
		btn.title = item.label || item.emojiId
		if (item.previewUrl) {
			const img = document.createElement('img')
			img.src = item.previewUrl
			img.alt = ''
			img.loading = 'lazy'
			btn.appendChild(img)
		}
		grid.appendChild(btn)
		return
	}

	if (item.unicode) {
		const btn = document.createElement('button')
		btn.type = 'button'
		btn.className = 'hub-emoji-grid-button'
		btn.dataset.emoji = item.unicode
		btn.textContent = item.unicode
		grid.appendChild(btn)
	}
}

/**
 * @param {HTMLElement} grid 网格容器
 * @param {string} i18nKey 空态/错误文案 i18n 键
 * @returns {void}
 */
function renderGridMessage(grid, i18nKey) {
	grid.replaceChildren()
	const el = document.createElement('div')
	el.className = 'hub-emoji-grid-empty'
	el.dataset.i18n = i18nKey
	grid.appendChild(el)
}

/**
 * @param {object} provider emoji 提供商
 * @param {object} tab 标签页
 * @param {HTMLElement} grid 网格容器
 * @param {object} ctx picker 上下文
 * @returns {Promise<void>}
 */
async function renderEmojiTabGrid(provider, tab, grid, ctx) {
	grid.replaceChildren()
	const { items, emptyI18n, errorI18n } = await provider.loadTabItems(tab, ctx)
	if (errorI18n) {
		renderGridMessage(grid, errorI18n)
		return
	}
	if (emptyI18n || !items.length) {
		renderGridMessage(grid, emptyI18n || 'chat.hub.recentEmojisEmpty')
		return
	}
	for (const item of items)
		appendEmojiGridItem(grid, item)
}

/**
 * @typedef {object} DockedEmojiPickerOptions
 * @property {HTMLElement} pickerEl
 * @property {HTMLElement} tabsEl
 * @property {HTMLElement} gridEl
 * @property {HTMLElement} triggerBtn
 * @property {HTMLTextAreaElement | HTMLInputElement} [inputEl]
 * @property {object} [ctx]
 * @property {() => object} [getCtx] 每次刷新时取最新上下文
 * @property {(token: string) => void} onInsert
 * @property {(item: object) => Promise<void>} [onSendAsSticker]
 * @property {HTMLElement} [closeWhenOpening]
 */

/**
 * 挂载停靠式 emoji 选择器（Chat Hub 等已有 DOM 结构）。
 * @param {DockedEmojiPickerOptions} options 停靠式选择器选项
 * @returns {Promise<{ refresh: () => Promise<void> } | null>} 刷新句柄或 null（无提供商）
 */
export async function mountDockedEmojiPicker(options) {
	const {
		pickerEl, tabsEl, gridEl, triggerBtn, inputEl,
		ctx = {}, getCtx, onInsert, onSendAsSticker, closeWhenOpening,
	} = options

	/**
	 * @returns {object} 最新 picker 上下文
	 */
	const resolveCtx = () => getCtx?.() ?? ctx

	const provider = await resolveEmojiProvider(ctx)
	if (!provider) return null

	/** @type {string | null} */
	let activeTabId = provider.RECENT_EMOJI_TAB_KEY ?? null
	/** @type {ReturnType<typeof setTimeout> | null} */
	let longPressTimer = null
	/** @type {boolean} */
	let longPressFired = false

	/**
	 * @returns {void}
	 */
	function clearLongPress() {
		if (longPressTimer) {
			clearTimeout(longPressTimer)
			longPressTimer = null
		}
	}

	/**
	 * @param {string} tabId 标签 id
	 * @returns {void}
	 */
	function setActiveTab(tabId) {
		activeTabId = tabId
		for (const tab of tabsEl.querySelectorAll('.hub-emoji-tab'))
			tab.classList.toggle('active', tab.dataset.tab === tabId)
	}

	/**
	 * @returns {Promise<void>}
	 */
	async function refresh() {
		const liveCtx = resolveCtx()
		const tabs = await provider.listTabs(liveCtx)
		const prevTab = activeTabId
		tabsEl.replaceChildren()
		for (const tab of tabs)
			tabsEl.appendChild(renderTabButton(tabsEl, tab, provider, prevTab))

		const tabExists = prevTab && tabsEl.querySelector(`[data-tab="${CSS.escape(prevTab)}"]`)
		const tabId = tabExists ? prevTab : tabs[0]?.id ?? null
		if (tabId) {
			setActiveTab(tabId)
			const tab = tabs.find(t => t.id === tabId) || tabs[0]
			if (tab) await renderEmojiTabGrid(provider, tab, gridEl, liveCtx)
		}
	}

	triggerBtn.addEventListener('click', event => {
		event.stopPropagation()
		closeWhenOpening?.classList.remove('show')
		pickerEl.classList.toggle('show')
		if (pickerEl.classList.contains('show'))
			void refresh()
	})

	tabsEl.addEventListener('click', event => {
		const tabButton = event.target.closest('[data-tab]')
		if (!tabButton) return
		const tabId = tabButton.dataset.tab
		setActiveTab(tabId)
		void (async () => {
			const liveCtx = resolveCtx()
			const tabs = await provider.listTabs(liveCtx)
			const tab = tabs.find(t => t.id === tabId)
			if (tab) await renderEmojiTabGrid(provider, tab, gridEl, liveCtx)
		})()
	})

	gridEl.addEventListener('pointerdown', event => {
		const groupBtn = event.target.closest('[data-group-emoji-ref]')
		if (!(groupBtn instanceof HTMLElement) || !onSendAsSticker) return
		longPressFired = false
		clearLongPress()
		longPressTimer = setTimeout(() => {
			longPressFired = true
			clearLongPress()
			const item = {
				kind: 'custom',
				emojiId: groupBtn.dataset.groupEmojiId,
				emojiRef: groupBtn.dataset.groupEmojiRef,
			}
			void onSendAsSticker(item).then(() => pickerEl.classList.remove('show'))
		}, GROUP_EMOJI_LONG_PRESS_MS)
	})

	for (const type of ['pointerup', 'pointercancel'])
		gridEl.addEventListener(type, clearLongPress)

	gridEl.addEventListener('click', event => {
		const groupBtn = event.target.closest('[data-group-emoji-ref]')
		if (groupBtn) {
			if (longPressFired) {
				longPressFired = false
				event.preventDefault()
				return
			}
			const ref = groupBtn.dataset.groupEmojiRef || ''
			if (inputEl) {
				const cursorPos = inputEl.selectionStart ?? inputEl.value.length
				inputEl.value = inputEl.value.substring(0, cursorPos) + ref + inputEl.value.substring(cursorPos)
				inputEl.focus()
			}
			else if (ref) onInsert(ref)
			pickerEl.classList.remove('show')
			return
		}

		const emojiButton = event.target.closest('[data-emoji]')
		if (!emojiButton) return
		const { emoji } = emojiButton.dataset
		if (!emoji) return
		if (inputEl) {
			const cursorPos = inputEl.selectionStart ?? inputEl.value.length
			inputEl.value = inputEl.value.substring(0, cursorPos) + emoji + inputEl.value.substring(cursorPos)
			inputEl.focus()
		}
		else onInsert(emoji)
		pickerEl.classList.remove('show')
	})

	gridEl.addEventListener('contextmenu', event => {
		const groupBtn = event.target.closest('[data-group-emoji-ref]')
		if (!groupBtn || !onSendAsSticker) return
		event.preventDefault()
		event.stopPropagation()
		clearLongPress()
		longPressFired = true
		const item = {
			kind: 'custom',
			emojiId: groupBtn.dataset.groupEmojiId,
			emojiRef: groupBtn.dataset.groupEmojiRef,
		}
		void onSendAsSticker(item).then(() => pickerEl.classList.remove('show'))
	})

	document.addEventListener('click', event => {
		if (pickerEl.classList.contains('show')
			&& !pickerEl.contains(event.target)
			&& !triggerBtn.contains(event.target))
			pickerEl.classList.remove('show')
	})

	return { refresh }
}

/**
 * 聚合扁平 emoji 条目（浮动模式 fallback）。
 * @param {object} [ctx] picker 上下文
 * @returns {Promise<Array<{ label: string, previewUrl?: string, raw: object, provider: object }>>} 扁平 emoji 条目
 */
export async function loadEmojiPickItems(ctx = {}) {
	const provider = await resolveEmojiProvider(ctx)
	if (!provider) return []

	/** @type {Array<{ label: string, previewUrl?: string, raw: object, provider: object }>} */
	const items = []
	if (provider.listTabs && provider.loadTabItems) {
		const tabs = await provider.listTabs(ctx)
		for (const tab of tabs) {
			const { items: tabItems } = await provider.loadTabItems(tab, ctx)
			for (const item of tabItems)
				items.push({
					label: item.label || item.unicode || item.emojiId || '',
					previewUrl: item.previewUrl || null,
					raw: item,
					provider,
				})
		}
	}
	return items
}

/**
 * 浮动 emoji 选择器（带 tab）。
 * @param {HTMLElement} anchor 定位锚点
 * @param {(text: string) => void} onInsert 选中后插入回调
 * @param {object} [ctx] picker 上下文
 * @returns {Promise<void>}
 */
export async function mountEmojiPicker(anchor, onInsert, ctx = {}) {
	document.getElementById('fount-shared-emoji-picker')?.remove()
	const provider = await resolveEmojiProvider(ctx)
	if (!provider?.listTabs) {
		const items = await loadEmojiPickItems(ctx)
		const panel = document.createElement('div')
		panel.id = 'fount-shared-emoji-picker'
		panel.className = 'fount-emoji-picker card shadow-lg'
		panel.style.cssText = 'position:fixed;z-index:10000;max-width:320px;max-height:240px;overflow:auto;padding:8px;display:grid;grid-template-columns:repeat(8,1fr);gap:4px;'
		const rect = anchor.getBoundingClientRect()
		panel.style.left = `${Math.min(rect.left, window.innerWidth - 330)}px`
		panel.style.top = `${Math.max(8, rect.top - 250)}px`
		for (const item of items) {
			const btn = document.createElement('button')
			btn.type = 'button'
			btn.className = 'btn btn-ghost btn-xs p-1'
			btn.title = item.label
			if (item.previewUrl)
				btn.innerHTML = `<img src="${escapeHtml(item.previewUrl)}" alt="" class="w-6 h-6 object-contain" />`
			else
				btn.textContent = item.label.slice(0, 2) || '?'
			btn.addEventListener('click', () => {
				const token = item.provider?.tokenForSelection?.(item.raw, ctx) || item.label
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
		return
	}

	const panel = document.createElement('div')
	panel.id = 'fount-shared-emoji-picker'
	panel.className = 'hub-emoji-picker show'
	panel.style.cssText = 'position:fixed;z-index:10000;width:320px;'
	const rect = anchor.getBoundingClientRect()
	panel.style.left = `${Math.min(rect.left, window.innerWidth - 330)}px`
	panel.style.top = `${Math.max(8, rect.top - 280)}px`

	const tabsEl = document.createElement('div')
	tabsEl.className = 'hub-emoji-tabs'
	const gridEl = document.createElement('div')
	gridEl.className = 'hub-emoji-grid'
	panel.append(tabsEl, gridEl)
	document.body.appendChild(panel)

	const tabs = await provider.listTabs(ctx)
	let activeId = tabs[0]?.id
	for (const tab of tabs)
		tabsEl.appendChild(renderTabButton(tabsEl, tab, provider, activeId))
	if (activeId) {
		const tab = tabs.find(t => t.id === activeId)
		if (tab) await renderEmojiTabGrid(provider, tab, gridEl, ctx)
	}

	tabsEl.addEventListener('click', event => {
		const tabButton = event.target.closest('[data-tab]')
		if (!tabButton) return
		activeId = tabButton.dataset.tab
		for (const tab of tabsEl.querySelectorAll('.hub-emoji-tab'))
			tab.classList.toggle('active', tab.dataset.tab === activeId)
		void (async () => {
			const tab = tabs.find(t => t.id === activeId)
			if (tab) await renderEmojiTabGrid(provider, tab, gridEl, ctx)
		})()
	})

	gridEl.addEventListener('click', event => {
		const groupBtn = event.target.closest('[data-group-emoji-ref]')
		if (groupBtn) {
			const ref = groupBtn.dataset.groupEmojiRef || ''
			if (ref) onInsert(ref)
			panel.remove()
			return
		}
		const emojiButton = event.target.closest('[data-emoji]')
		if (!emojiButton?.dataset.emoji) return
		onInsert(emojiButton.dataset.emoji)
		panel.remove()
	})

	setTimeout(() => {
		/**
		 * @param {Event} e 外部点击事件
		 * @returns {void}
		 */
		const close = e => {
			if (!panel.contains(e.target) && !anchor.contains(e.target)) {
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
export function wireEmojiPickerButton(button, onInsert, ctx = {}) {
	if (!(button instanceof HTMLElement)) return
	button.addEventListener('click', e => {
		e.preventDefault()
		void mountEmojiPicker(button, onInsert, ctx)
	})
}
