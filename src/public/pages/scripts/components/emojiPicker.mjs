/**
 * 共享 emoji picker：消费 registries.emoji 提供商（停靠 / 浮动两种模式）。
 */
import { importRegistryModules } from '../api/registries.mjs'

/**
 * @returns {Promise<object | null>} 首个可用 emoji 提供商
 */
async function resolveEmojiProvider() {
	const modules = await importRegistryModules('emoji')
	for (const { module } of modules) {
		const provider = module?.default ?? module
		if (provider?.listTabs && provider?.loadTabItems)
			return provider
	}
	return null
}

/**
 * @param {HTMLTextAreaElement | HTMLInputElement} inputEl 输入框
 * @param {string} token 待插入文本
 * @returns {void}
 */
function insertAtCursor(inputEl, token) {
	const cursorPos = inputEl.selectionStart ?? inputEl.value.length
	inputEl.value = inputEl.value.substring(0, cursorPos) + token + inputEl.value.substring(cursorPos)
	inputEl.focus()
}

/**
 * @param {HTMLElement} panel 浮动面板
 * @param {HTMLElement} anchor 定位锚点
 * @param {{ panelWidth?: number, heightOffset?: number }} [opts] 尺寸选项
 * @returns {void}
 */
function positionFloatingPanel(panel, anchor, { panelWidth = 320, heightOffset = 280 } = {}) {
	const rect = anchor.getBoundingClientRect()
	panel.style.left = `${Math.min(rect.left, window.innerWidth - panelWidth - 10)}px`
	panel.style.top = `${Math.max(8, rect.top - heightOffset)}px`
}

/**
 * @param {HTMLElement} panel 浮动面板
 * @param {() => void} onClose 关闭回调
 * @param {HTMLElement} [alsoInside] 点击其内部时不关闭
 * @returns {void}
 */
function wireOutsideClickClose(panel, onClose, alsoInside) {
	setTimeout(() => {
		/**
		 * @param {Event} event 文档点击
		 * @returns {void}
		 */
		const close = event => {
			if (panel.contains(event.target) || alsoInside?.contains(event.target)) return
			onClose()
			document.removeEventListener('click', close, true)
		}
		document.addEventListener('click', close, true)
	}, 0)
}

/**
 * @param {object} tab 标签页描述
 * @param {object} provider emoji 提供商
 * @param {string | null} activeTabId 当前激活标签 id
 * @returns {HTMLButtonElement} 标签按钮元素
 */
function renderTabButton(tab, provider, activeTabId) {
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
		const gridButton = document.createElement('button')
		gridButton.type = 'button'
		gridButton.className = 'hub-emoji-grid-button hub-group-emoji-grid-button'
		gridButton.dataset.groupEmojiId = item.emojiId
		gridButton.dataset.groupEmojiRef = item.emojiRef
		gridButton.title = item.label || item.emojiId
		if (item.previewUrl) {
			const img = document.createElement('img')
			img.src = item.previewUrl
			img.alt = ''
			img.loading = 'lazy'
			gridButton.appendChild(img)
		}
		grid.appendChild(gridButton)
		return
	}

	if (item.unicode) {
		const gridButton = document.createElement('button')
		gridButton.type = 'button'
		gridButton.className = 'hub-emoji-grid-button'
		gridButton.dataset.emoji = item.unicode
		gridButton.textContent = item.unicode
		grid.appendChild(gridButton)
	}
}

/**
 * @param {HTMLElement} grid 网格容器
 * @param {string} i18nKey 空态/错误文案 i18n 键
 * @returns {void}
 */
function renderGridMessage(grid, i18nKey) {
	grid.replaceChildren()
	const emptyMessage = document.createElement('div')
	emptyMessage.className = 'hub-emoji-grid-empty'
	emptyMessage.dataset.i18n = i18nKey
	grid.appendChild(emptyMessage)
}

/**
 * @param {HTMLElement} tabsEl 标签容器
 * @param {string} tabId 标签 id
 * @returns {void}
 */
function setActiveTabButton(tabsEl, tabId) {
	for (const tabButton of tabsEl.querySelectorAll('.hub-emoji-tab'))
		tabButton.classList.toggle('active', tabButton.dataset.tab === tabId)
}

/**
 * @param {object} provider emoji 提供商
 * @param {object} tab 标签页
 * @param {HTMLElement} grid 网格容器
 * @param {object} pickerContext picker 上下文
 * @returns {Promise<void>}
 */
async function renderEmojiTabGrid(provider, tab, grid, pickerContext) {
	grid.replaceChildren()
	const { items, emptyI18n, errorI18n } = await provider.loadTabItems(tab, pickerContext)
	if (errorI18n) {
		renderGridMessage(grid, errorI18n)
		return
	}
	if (emptyI18n) {
		renderGridMessage(grid, emptyI18n)
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
 * @property {object} [pickerContext]
 * @property {() => object} [getPickerContext] 每次刷新时取最新上下文
 * @property {(token: string) => void} [onInsert]
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
		pickerContext = {}, getPickerContext, onInsert, closeWhenOpening,
	} = options

	/**
	 * @returns {object} 最新 picker 上下文
	 */
	const resolvePickerContext = () => getPickerContext?.() ?? pickerContext

	const provider = await resolveEmojiProvider()
	if (!provider) return null

	/** @type {string | null} */
	let activeTabId = null

	/**
	 * @param {string} tabId 标签 id
	 * @returns {void}
	 */
	function setActiveTab(tabId) {
		activeTabId = tabId
		setActiveTabButton(tabsEl, tabId)
	}

	/**
	 * @returns {Promise<void>}
	 */
	async function refresh() {
		const liveContext = resolvePickerContext()
		const tabs = await provider.listTabs(liveContext)
		const prevTab = activeTabId
		tabsEl.replaceChildren()
		for (const tab of tabs)
			tabsEl.appendChild(renderTabButton(tab, provider, prevTab))

		const tabExists = prevTab && tabsEl.querySelector(`[data-tab="${CSS.escape(prevTab)}"]`)
		const tabId = tabExists ? prevTab : tabs[0]?.id ?? null
		if (!tabId) return
		setActiveTab(tabId)
		const tab = tabs.find(tab => tab.id === tabId)
		if (tab) await renderEmojiTabGrid(provider, tab, gridEl, liveContext)
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
			const liveContext = resolvePickerContext()
			const tabs = await provider.listTabs(liveContext)
			const tab = tabs.find(tab => tab.id === tabId)
			if (tab) await renderEmojiTabGrid(provider, tab, gridEl, liveContext)
		})()
	})

	gridEl.addEventListener('click', event => {
		const groupButton = event.target.closest('[data-group-emoji-ref]')
		if (groupButton) {
			const ref = groupButton.dataset.groupEmojiRef || ''
			if (inputEl) insertAtCursor(inputEl, ref)
			else if (ref) onInsert?.(ref)
			pickerEl.classList.remove('show')
			return
		}

		const gridButton = event.target.closest('[data-emoji]')
		if (!gridButton?.dataset.emoji) return
		const { emoji } = gridButton.dataset
		if (inputEl) insertAtCursor(inputEl, emoji)
		else onInsert?.(emoji)
		pickerEl.classList.remove('show')
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
 * 浮动 emoji 选择器（带 tab）。
 * @param {HTMLElement} anchor 定位锚点
 * @param {(text: string) => void} onInsert 选中后插入回调
 * @param {object} [pickerContext] picker 上下文
 * @returns {Promise<void>}
 */
export async function mountEmojiPicker(anchor, onInsert, pickerContext = {}) {
	document.getElementById('fount-shared-emoji-picker')?.remove()
	const provider = await resolveEmojiProvider()
	if (!provider) return

	const panel = document.createElement('div')
	panel.id = 'fount-shared-emoji-picker'
	panel.className = 'hub-emoji-picker show'
	panel.style.cssText = 'position:fixed;z-index:10000;width:320px;'
	positionFloatingPanel(panel, anchor)

	const tabsEl = document.createElement('div')
	tabsEl.className = 'hub-emoji-tabs'
	const gridEl = document.createElement('div')
	gridEl.className = 'hub-emoji-grid'
	panel.append(tabsEl, gridEl)
	document.body.appendChild(panel)

	const tabs = await provider.listTabs(pickerContext)
	let activeTabId = tabs[0]?.id
	for (const tab of tabs)
		tabsEl.appendChild(renderTabButton(tab, provider, activeTabId))
	if (activeTabId) {
		const tab = tabs.find(tab => tab.id === activeTabId)
		if (tab) await renderEmojiTabGrid(provider, tab, gridEl, pickerContext)
	}

	tabsEl.addEventListener('click', event => {
		const tabButton = event.target.closest('[data-tab]')
		if (!tabButton) return
		activeTabId = tabButton.dataset.tab
		setActiveTabButton(tabsEl, activeTabId)
		void (async () => {
			const liveTabs = await provider.listTabs(pickerContext)
			const tab = liveTabs.find(tab => tab.id === activeTabId)
			if (tab) await renderEmojiTabGrid(provider, tab, gridEl, pickerContext)
		})()
	})

	gridEl.addEventListener('click', event => {
		const groupButton = event.target.closest('[data-group-emoji-ref]')
		if (groupButton) {
			onInsert(groupButton.dataset.groupEmojiRef || '')
			panel.remove()
			return
		}
		const gridButton = event.target.closest('[data-emoji]')
		if (!gridButton?.dataset.emoji) return
		onInsert(gridButton.dataset.emoji)
		panel.remove()
	})

	wireOutsideClickClose(panel, () => panel.remove(), anchor)
}

/**
 * @param {HTMLElement} button 触发按钮
 * @param {(text: string) => void} onInsert 选中后插入回调
 * @param {object} [pickerContext] picker 上下文
 * @returns {void}
 */
export function wireEmojiPickerButton(button, onInsert, pickerContext = {}) {
	button.addEventListener('click', event => {
		event.preventDefault()
		void mountEmojiPicker(button, onInsert, pickerContext)
	})
}
