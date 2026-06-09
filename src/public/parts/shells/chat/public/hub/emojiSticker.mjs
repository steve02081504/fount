/**
 * 【文件】public/hub/emojiSticker.mjs
 * 【职责】Hub 表情与贴纸选择器初始化：绑定 composer 旁 picker、自定义表情 URL 与发送回调。
 * 【原理】`initEmojiStickerPickers` 挂载 picker 面板、搜索与分组 Tab，写入输入框或直发消息；选择结果通过 `sendMessage`/`reloadMessages` 反映到频道；不拼装历史行 HTML。
 * 【数据结构】hubStore（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】../../../../scripts/template、../../../../scripts/toast、../src/api/groupApi、../src/emojiUsageApi、../src/groupEmojiApi、../src/lib/unicodeEmojiData、core/domUtils。
 */
import {
	mountTemplate,
	renderTemplate,
	renderTemplateAsHtmlString,
} from '../../../../scripts/template.mjs'
import { showToastI18n } from '../../../../scripts/toast.mjs'
import { sendGroupMessage } from '../src/api/groupApi.mjs'
import { fetchFrequentEmojis } from '../src/emojiUsageApi.mjs'
import { groupEmojiDataApiPath } from '../src/groupEmojiApi.mjs'
import {
	CURRENT_GROUP_EMOJI_TAB_GLYPH,
	emojiTabGlyphHtml,
	extractGroupIdFromTabKey,
	GROUP_EMOJI_TAB_GLYPH,
	GROUP_EMOJI_TAB_PREFIX,
	groupTabKey,
	loadUnicodeEmojiByGroup,
	RECENT_EMOJI_TAB_GLYPH,
	RECENT_EMOJI_TAB_KEY,
	unicodeEmojiGroupFromTabKey,
	unicodeEmojiGroupI18nKey,
	unicodeEmojiGroupTabGlyph,
	unicodeEmojiTabKey,
} from '../src/lib/unicodeEmojiData.mjs'

import { escapeHtml } from './core/domUtils.mjs'

const FREQUENT_EMOJI_LIMIT = 32

/** @type {string | null} */
let activeEmojiTab = null

/** @type {boolean} */
let unicodeTabsBuilt = false

/**
 * @param {string} tabKey 当前 tab
 * @returns {void}
 */
function setActiveEmojiTab(tabKey) {
	activeEmojiTab = tabKey
	document.querySelectorAll('.hub-emoji-tab').forEach(tab => {
		tab.classList.toggle('active', tab.dataset.tab === tabKey)
	})
}

/**
 * @param {HTMLElement} tabsEl tab 容器
 * @returns {HTMLElement | null} 首个 Unicode 分类 tab（群 tab 插入点）
 */
function firstUnicodeTabAnchor(tabsEl) {
	for (const tab of tabsEl.querySelectorAll('.hub-emoji-tab')) {
		const key = tab.dataset.tab
		if (!key || key === RECENT_EMOJI_TAB_KEY || key.startsWith(GROUP_EMOJI_TAB_PREFIX)) continue
		return tab
	}
	return null
}

/**
 * @param {HTMLElement} tabsEl tab 容器
 * @returns {void}
 */
function appendRecentTab(tabsEl) {
	tabsEl.querySelector(`[data-tab="${RECENT_EMOJI_TAB_KEY}"]`)?.remove()
	const tabButton = document.createElement('button')
	tabButton.type = 'button'
	tabButton.className = 'hub-emoji-tab'
	tabButton.dataset.tab = RECENT_EMOJI_TAB_KEY
	tabButton.dataset.i18n = 'chat.hub.recentEmojiTab'
	tabButton.innerHTML = emojiTabGlyphHtml(RECENT_EMOJI_TAB_GLYPH)
	if (tabsEl.firstChild) tabsEl.insertBefore(tabButton, tabsEl.firstChild)
	else tabsEl.appendChild(tabButton)
}

/**
 * @param {{ groupId: string, name?: string, avatar?: string | null }} group 群摘要
 * @param {boolean} isCurrent 是否为当前群
 * @returns {string} tab 按钮 innerHTML
 */
function groupTabInnerHtml(group, isCurrent) {
	if (isCurrent) return emojiTabGlyphHtml(CURRENT_GROUP_EMOJI_TAB_GLYPH)
	if (group.avatar)
		return `<img src="${escapeHtml(group.avatar)}" class="hub-emoji-tab-icon hub-emoji-tab-avatar" width="20" height="20" alt="" aria-hidden="true" />`
	return emojiTabGlyphHtml(GROUP_EMOJI_TAB_GLYPH)
}

/**
 * @param {HTMLElement} tabsEl tab 容器
 * @param {string | null} currentGroupId 当前群 ID
 * @param {Array<{ groupId: string, name?: string, avatar?: string | null }>} allGroups 已加入群列表
 * @returns {void}
 */
function appendGroupTabs(tabsEl, currentGroupId, allGroups) {
	for (const el of tabsEl.querySelectorAll(`[data-tab^="${GROUP_EMOJI_TAB_PREFIX}"]`))
		el.remove()

	const ordered = []
	if (currentGroupId) {
		const current = allGroups.find(g => g.groupId === currentGroupId)
		if (current) ordered.push({ group: current, isCurrent: true })
		for (const g of allGroups)
			if (g.groupId !== currentGroupId) ordered.push({ group: g, isCurrent: false })
	}
	else
		for (const g of allGroups) ordered.push({ group: g, isCurrent: false })

	const anchor = firstUnicodeTabAnchor(tabsEl)
	for (const { group, isCurrent } of ordered) {
		const tabButton = document.createElement('button')
		tabButton.type = 'button'
		tabButton.className = 'hub-emoji-tab'
		tabButton.dataset.tab = groupTabKey(group.groupId)
		tabButton.title = group.name || group.groupId
		if (isCurrent) tabButton.dataset.i18n = 'chat.hub.currentGroupEmojiTab'
		tabButton.innerHTML = groupTabInnerHtml(group, isCurrent)
		if (anchor) tabsEl.insertBefore(tabButton, anchor)
		else tabsEl.appendChild(tabButton)
	}
}

/**
 * @param {HTMLElement} tabsEl tab 容器
 * @returns {Promise<void>}
 */
async function ensureUnicodeEmojiTabs(tabsEl) {
	if (unicodeTabsBuilt) return
	const { order } = await loadUnicodeEmojiByGroup()
	for (const groupName of order) {
		const tabKey = unicodeEmojiTabKey(groupName)
		const tabButton = document.createElement('button')
		tabButton.type = 'button'
		tabButton.className = 'hub-emoji-tab'
		tabButton.dataset.tab = tabKey
		tabButton.dataset.i18n = unicodeEmojiGroupI18nKey(groupName)
		tabButton.innerHTML = emojiTabGlyphHtml(unicodeEmojiGroupTabGlyph(groupName))
		tabsEl.appendChild(tabButton)
	}
	unicodeTabsBuilt = true
}

/**
 * @param {string | null} currentGroupId 当前群 ID
 * @param {() => Array<{ groupId: string, name?: string, avatar?: string | null }>} getGroups 已加入群列表
 * @returns {Promise<string>} 激活的 tab 键
 */
async function refreshEmojiPickerTabs(currentGroupId, getGroups) {
	const tabsEl = document.getElementById('hub-emoji-tabs')
	if (!tabsEl) return RECENT_EMOJI_TAB_KEY

	const prevTab = activeEmojiTab
	const allGroups = getGroups?.() ?? []

	appendRecentTab(tabsEl)
	appendGroupTabs(tabsEl, currentGroupId, allGroups)
	await ensureUnicodeEmojiTabs(tabsEl)

	const tabExists = prevTab && tabsEl.querySelector(`[data-tab="${CSS.escape(prevTab)}"]`)
	const tab = tabExists ? prevTab : RECENT_EMOJI_TAB_KEY
	setActiveEmojiTab(tab)
	return tab
}

/**
 * @param {HTMLElement} grid 表情网格
 * @returns {Promise<void>}
 */
async function renderRecentEmojiGrid(grid) {
	const entries = await fetchFrequentEmojis(FREQUENT_EMOJI_LIMIT)
	if (!entries.length) {
		grid.replaceChildren(await renderTemplate('hub/emoji/grid_empty', { i18nKey: 'chat.hub.recentEmojisEmpty' }))
		return
	}
	for (const entry of entries) {
		if (entry.kind === 'custom' && entry.groupId && entry.emojiId) {
			const previewUrl = groupEmojiDataApiPath(entry.groupId, entry.emojiId)
			const emojiRef = `:[${entry.groupId}/${entry.emojiId}]:`
			grid.appendChild(await renderTemplate('hub/emoji/group_button', {
				emojiId: escapeHtml(entry.emojiId),
				emojiRef: escapeHtml(emojiRef),
				name: escapeHtml(entry.emojiId),
				dataUrl: escapeHtml(previewUrl),
			}))
			continue
		}
		if (entry.kind === 'unicode' && entry.unicode)
			grid.appendChild(await renderTemplate('hub/emoji/button', { emoji: entry.unicode }))
	}
}

/**
 * @param {HTMLElement} grid 表情网格
 * @param {string} targetGroupId 群 ID
 * @returns {Promise<void>}
 */
async function renderGroupEmojiGrid(grid, targetGroupId) {
	try {
		const resp = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(targetGroupId)}/emojis`, {
			credentials: 'include',
		})
		const data = await resp.json()
		if (!resp.ok) throw new Error(data.error || 'load failed')
		const entries = data.entries || []
		if (!entries.length) {
			grid.replaceChildren(await renderTemplate('hub/emoji/grid_empty', { i18nKey: 'chat.hub.groupEmojisEmpty' }))
			return
		}
		for (const entry of entries) {
			const previewUrl = groupEmojiDataApiPath(targetGroupId, entry.emojiId)
			const emojiRef = `:[${targetGroupId}/${entry.emojiId}]:`
			grid.appendChild(await renderTemplate('hub/emoji/group_button', {
				emojiId: escapeHtml(entry.emojiId),
				emojiRef: escapeHtml(emojiRef),
				name: escapeHtml(entry.name || entry.emojiId),
				dataUrl: escapeHtml(previewUrl),
			}))
		}
	}
	catch {
		grid.replaceChildren(await renderTemplate('hub/emoji/grid_empty', { i18nKey: 'chat.hub.groupEmojisLoadFailed' }))
	}
}

/**
 * @param {string} tab tab 键
 * @returns {Promise<void>}
 */
async function renderEmojiGrid(tab) {
	const grid = document.getElementById('hub-emoji-grid')
	if (!grid) return
	grid.replaceChildren()

	if (tab === RECENT_EMOJI_TAB_KEY) {
		await renderRecentEmojiGrid(grid)
		return
	}

	const tabGroupId = extractGroupIdFromTabKey(tab)
	if (tabGroupId) {
		await renderGroupEmojiGrid(grid, tabGroupId)
		return
	}

	const { byGroup, order } = await loadUnicodeEmojiByGroup()
	const groupName = unicodeEmojiGroupFromTabKey(tab, order)
	const emojis = groupName ? byGroup[groupName] || [] : []
	for (const emoji of emojis)
		grid.appendChild(await renderTemplate('hub/emoji/button', { emoji }))
}

/**
 * @param {string} url 贴纸资源 URL
 * @returns {Promise<{stickerBase64: string, mimeType: string}>} base64 与 MIME 类型
 */
async function fetchStickerPayload(url) {
	const response = await fetch(url, { credentials: 'include' })
	if (!response.ok) throw new Error(`sticker fetch ${response.status}`)
	const blob = await response.blob()
	const mimeType = blob.type || 'image/png'
	const bytes = new Uint8Array(await blob.arrayBuffer())
	if (bytes.length > 240_000) throw new Error('sticker file too large for DAG inline')
	return { stickerBase64: btoa(String.fromCharCode(...bytes)), mimeType }
}

/**
 * @param {HTMLElement} grid 贴纸网格容器
 * @param {boolean} showMarketLink 是否展示市场链接
 * @returns {Promise<void>}
 */
async function renderStickersEmpty(grid, showMarketLink) {
	await mountTemplate(grid, 'hub/stickers/empty', { showMarketLink: !!showMarketLink })
}

const GROUP_EMOJI_LONG_PRESS_MS = 500

/**
 * 初始化表情/贴纸选择器的交互逻辑。
 * @param {object} pickerCallbacks 选择器回调
 * @param {() => string} pickerCallbacks.getUsername 返回当前用户名
 * @param {() => {groupId: string|null, channelId: string|null, groupId: string|null}} pickerCallbacks.getContext 返回当前聊天上下文
 * @param {() => Array<{ groupId: string, name?: string, avatar?: string | null }>} pickerCallbacks.getGroups 已加入群列表
 * @param {(content: string|object) => Promise<void>} pickerCallbacks.sendMessage 发送消息回调
 * @param {() => Promise<void>} pickerCallbacks.reloadMessages 重新加载消息回调
 */
export function initEmojiStickerPickers({ getUsername, getContext, getGroups, sendMessage, reloadMessages }) {
	/** @type {ReturnType<typeof setTimeout> | null} */
	let groupEmojiLongPressTimer = null
	/** @type {boolean} */
	let groupEmojiLongPressFired = false

	/**
	 * @returns {void}
	 */
	function clearGroupEmojiLongPress() {
		if (groupEmojiLongPressTimer) {
			clearTimeout(groupEmojiLongPressTimer)
			groupEmojiLongPressTimer = null
		}
	}

	/**
	 * 将群自定义表情作为贴纸消息发送。
	 * @param {HTMLElement} groupBtn 群表情按钮
	 * @returns {Promise<void>}
	 */
	async function sendGroupEmojiAsSticker(groupBtn) {
		const { groupId, channelId } = getContext()
		if (!groupId || !channelId) return
		const emojiRef = groupBtn.dataset.groupEmojiRef
		document.getElementById('hub-emoji-picker').classList.remove('show')
		try {
			await sendGroupMessage(groupId, channelId, {
				type: 'sticker',
				emojiRef,
				stickerName: groupBtn.dataset.groupEmojiId || 'emoji',
			})
			await reloadMessages()
		}
		catch (err) {
			showToastI18n('error', 'chat.hub.sendStickerFailed', { error: err.message })
		}
	}

	document.getElementById('hub-emoji-button').addEventListener('click', (event) => {
		event.stopPropagation()
		const picker = document.getElementById('hub-emoji-picker')
		picker.classList.toggle('show')
		if (picker.classList.contains('show')) {
			const { groupId } = getContext()
			void (async () => {
				const tab = await refreshEmojiPickerTabs(groupId, getGroups)
				await renderEmojiGrid(tab)
			})()
		}
	})

	document.getElementById('hub-emoji-tabs').addEventListener('click', (event) => {
		const tabButton = event.target.closest('[data-tab]')
		if (!tabButton) return
		setActiveEmojiTab(tabButton.dataset.tab)
		void renderEmojiGrid(tabButton.dataset.tab)
	})

	const emojiGrid = document.getElementById('hub-emoji-grid')

	emojiGrid.addEventListener('pointerdown', (event) => {
		const groupBtn = event.target.closest('[data-group-emoji-ref]')
		if (!(groupBtn instanceof HTMLElement)) return
		groupEmojiLongPressFired = false
		clearGroupEmojiLongPress()
		groupEmojiLongPressTimer = setTimeout(() => {
			groupEmojiLongPressFired = true
			clearGroupEmojiLongPress()
			void sendGroupEmojiAsSticker(groupBtn)
		}, GROUP_EMOJI_LONG_PRESS_MS)
	})

	for (const type of ['pointerup', 'pointercancel'])
		emojiGrid.addEventListener(type, clearGroupEmojiLongPress)

	emojiGrid.addEventListener('click', (event) => {
		const groupBtn = event.target.closest('[data-group-emoji-ref]')
		if (groupBtn) {
			if (groupEmojiLongPressFired) {
				groupEmojiLongPressFired = false
				event.preventDefault()
				return
			}
			const input = document.getElementById('hub-message-input')
			const ref = groupBtn.dataset.groupEmojiRef || ''
			const cursorPos = input.selectionStart || input.value.length
			input.value = input.value.substring(0, cursorPos) + ref + input.value.substring(cursorPos)
			input.focus()
			document.getElementById('hub-emoji-picker').classList.remove('show')
			return
		}

		const emojiButton = event.target.closest('[data-emoji]')
		if (!emojiButton) return
		const { emoji } = emojiButton.dataset
		const input = document.getElementById('hub-message-input')
		const cursorPos = input.selectionStart || input.value.length
		input.value = input.value.substring(0, cursorPos) + emoji + input.value.substring(cursorPos)
		input.focus()
		document.getElementById('hub-emoji-picker').classList.remove('show')
	})

	emojiGrid.addEventListener('contextmenu', (event) => {
		const groupBtn = event.target.closest('[data-group-emoji-ref]')
		if (!groupBtn) return
		event.preventDefault()
		event.stopPropagation()
		clearGroupEmojiLongPress()
		groupEmojiLongPressFired = true
		void sendGroupEmojiAsSticker(groupBtn)
	})

	document.addEventListener('click', (event) => {
		const emojiPicker = document.getElementById('hub-emoji-picker')
		if (emojiPicker.classList.contains('show') && !emojiPicker.contains(event.target) && !event.target.closest('#hub-emoji-button'))
			emojiPicker.classList.remove('show')

		const stickerPicker = document.getElementById('hub-sticker-picker')
		if (stickerPicker.classList.contains('show') && !stickerPicker.contains(event.target) && !event.target.closest('#hub-sticker-button'))
			stickerPicker.classList.remove('show')
	})

	let stickersLoaded = false
	/**
	 * @returns {Promise<void>}
	 */
	async function loadStickers() {
		if (stickersLoaded) return
		stickersLoaded = true
		const grid = document.getElementById('hub-sticker-grid')
		try {
			const collResp = await fetch(
				'/api/parts/shells:chat/stickers/collection',
				{ credentials: 'include' },
			)
			if (!collResp.ok) throw new Error('Failed')
			const collData = await collResp.json()

			const installedPacks = collData.collection?.installedPacks || []
			if (!installedPacks.length) {
				await renderStickersEmpty(grid, true)
				return
			}

			const allStickers = []
			for (const packId of installedPacks)
				try {
					const packResp = await fetch(
						`/api/parts/shells:chat/stickers/packs/${encodeURIComponent(packId)}`,
						{ credentials: 'include' },
					)
					if (!packResp.ok) continue
					const packData = await packResp.json()
					if (packData.pack?.stickers)
						allStickers.push(...packData.pack.stickers)
				} catch { }

			if (!allStickers.length) {
				await renderStickersEmpty(grid, false)
				return
			}

			grid.replaceChildren()
			for (const sticker of allStickers) {
				const thumbHtml = await renderTemplateAsHtmlString('hub/stickers/grid_thumb', {
					hasUrl: !!sticker.url,
					url: sticker.url || '',
					alt: sticker.name || '',
					escapeHtml,
				})
				grid.appendChild(await renderTemplate('hub/stickers/grid_item', {
					stickerId: escapeHtml(sticker.id),
					stickerUrl: escapeHtml(sticker.url || ''),
					stickerTitle: escapeHtml(sticker.name || sticker.id),
					thumbHtml,
				}))
			}
		} catch (err) {
			stickersLoaded = false
			await mountTemplate(grid, 'hub/stickers/load_failed', { errorMessage: err.message })
		}
	}

	document.getElementById('hub-sticker-button').addEventListener('click', (event) => {
		event.stopPropagation()
		const picker = document.getElementById('hub-sticker-picker')
		document.getElementById('hub-emoji-picker').classList.remove('show')
		picker.classList.toggle('show')
		if (picker.classList.contains('show')) loadStickers()
	})

	document.getElementById('hub-sticker-grid').addEventListener('click', async (event) => {
		const stickerItem = event.target.closest('.hub-sticker-item')
		if (!stickerItem) return
		const { groupId, channelId } = getContext()
		if (!groupId || !channelId) return
		const { stickerId, stickerUrl } = stickerItem.dataset
		document.getElementById('hub-sticker-picker').classList.remove('show')
		try {
			if (groupId && channelId && stickerUrl) {
				const { stickerBase64, mimeType } = await fetchStickerPayload(stickerUrl)
				await sendGroupMessage(groupId, channelId, {
					type: 'sticker',
					stickerId,
					stickerName: stickerId,
					mimeType,
					stickerBase64,
				})
				const username = getUsername()
				if (username)
					void fetch(`/api/parts/shells:chat/stickers/recent/${encodeURIComponent(stickerId)}`, {
						method: 'POST',
						credentials: 'include',
					})
				await reloadMessages()
			}
			else {
				if (!stickerUrl) {
					showToastI18n('error', 'chat.hub.sendStickerFailed')
					return
				}
				await sendMessage(`[sticker:${stickerId}|${stickerUrl}]`)
				const username = getUsername()
				if (username)
					void fetch(`/api/parts/shells:chat/stickers/recent/${encodeURIComponent(stickerId)}`, {
						method: 'POST',
						credentials: 'include',
					})
			}
		}
		catch (err) {
			showToastI18n('error', 'chat.hub.sendStickerFailed', { error: err.message })
		}
	})
}
