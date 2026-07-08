/**
 * 【文件】public/hub/pinsBookmarks.mjs
 * 【职责】置顶消息与聊天书签：拉取列表、取消置顶/删除书签，渲染到顶栏搜索框左侧的两个弹出面板。
 * 【原理】`refreshPinsBookmarks` 更新 `#hub-pins-wrap`/`#hub-bookmarks-wrap` 面板内条目与按钮计数徽标，配合 `banners.setPinsBookmarksWrapVisible` 控制按钮可见性；`wirePinsBookmarksPanels` 负责按钮的展开/收起交互。条目摘要依赖 `pinPreview`；点击可跳转到对应消息事件。
 * 【数据结构】hubStore（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】../../../../scripts/template、../src/api/groupApi、banners、core/domUtils、core/state、groupNav、messages/messages、messages/pinPreview。
 */
import { mountTemplate, renderTemplate } from '/scripts/features/template.mjs'
import {
	getChatBookmarks,
	getGroupState,
	removeChatBookmark,
	unpinMessage,
} from '../src/api/groupApi.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

import { setPinsBookmarksWrapVisible, refreshChannelPinsBar } from './banners.mjs'
import { hubStore } from './core/state.mjs'
import { selectChannel, selectGroup } from './groupNav.mjs'
import { scrollToMessageEventId } from './messages/messages.mjs'
import { pinPreviewTemplateFields, resolvePinMessagePreview } from './messages/pinPreview.mjs'

const SIDEBAR_LABEL_MAX = 56

/**
 * 更新顶栏弹出按钮的计数徽标。
 * @param {string} countElId 徽标元素 id
 * @param {number} count 数量
 * @returns {void}
 */
function setPopCount(countElId, count) {
	const el = document.getElementById(countElId)
	if (!el) return
	if (count > 0) {
		el.textContent = count > 99 ? '99+' : String(count)
		el.removeAttribute('hidden')
	}
	else el.setAttribute('hidden', '')
}

/**
 * 统一群 ID 键，避免大小写不一致导致名称解析失败。
 * @param {string} value 群 ID
 * @returns {string} 规范化键
 */
function normGroupId(value) {
	return String(value || '').trim().toLowerCase()
}

/**
 * 压缩侧栏文案长度并折叠空白，避免长文本撑坏布局。
 * @param {string} value 原始文本
 * @param {number} [max=SIDEBAR_LABEL_MAX] 最大显示长度
 * @returns {string} 截断后的文案
 */
function compactSidebarText(value, max = SIDEBAR_LABEL_MAX) {
	const text = String(value || '').replace(/\s+/g, ' ').trim()
	if (!text) return ''
	return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text
}

/**
 * 刷新 Hub 侧栏的置顶消息与书签列表。
 * @returns {Promise<void>}
 */
export async function refreshPinsBookmarks() {
	const pinsHost = document.getElementById('hub-pins-wrap')
	const bookmarksHost = document.getElementById('hub-bookmarks-wrap')
	if (!pinsHost || !bookmarksHost) return
	if (hubStore.context.currentMode !== 'groups' || !hubStore.context.currentGroupId || !hubStore.context.currentState?.isMember) {
		setPinsBookmarksWrapVisible(false)
		return
	}
	setPinsBookmarksWrapVisible(true)
	const pinsBy = hubStore.context.currentState.pinsByChannel || {}
	const pinEntries = []
	for (const [channelId, ids] of Object.entries(pinsBy)) {
		if (!Array.isArray(ids) || !ids.length) continue
		const channelName = hubStore.context.currentState.channels?.[channelId]?.name || channelId
		for (const eventId of ids) {
			if (!eventId) continue
			pinEntries.push({ channelId, channelName, eventId })
		}
	}
	const previews = await Promise.all(
		pinEntries.map(({ channelId, eventId }) =>
			resolvePinMessagePreview(hubStore.context.currentGroupId, channelId, eventId)),
	)
	pinsHost.replaceChildren()
	if (pinEntries.length)
		for (const [index, { channelId, channelName, eventId }] of pinEntries.entries()) {
			const previewFields = pinPreviewTemplateFields(
				previews[index] || { text: eventId.slice(0, 8) },
			)
			pinsHost.appendChild(await renderTemplate('hub/pins/row', {
				channelId: escapeHtml(channelId),
				channelName: escapeHtml(compactSidebarText(channelName, 28)),
				eventId: escapeHtml(eventId),
				...previewFields,
			}))
		}
	else await mountTemplate(pinsHost, 'hub/nav/side_muted', { i18nKey: 'chat.hub.noPins' })
	setPopCount('hub-pins-count', pinEntries.length)

	pinsHost.querySelectorAll('.hub-pinned-message-row').forEach(pinRow => {
		pinRow.addEventListener('click', async () => {
			const channelId = pinRow.getAttribute('data-pinned-message-channel')
			const eventId = pinRow.getAttribute('data-pinned-message-event')
			if (!channelId || !eventId) return
			if (channelId !== hubStore.context.currentChannelId) await selectChannel(channelId)
			await scrollToMessageEventId(eventId)
		})
	})
	pinsHost.querySelectorAll('.hub-pinned-message-unpin-button').forEach(unpinButton => {
		unpinButton.addEventListener('click', async (clickEvent) => {
			clickEvent.stopPropagation()
			const channelId = unpinButton.getAttribute('data-pinned-message-channel')
			const eventId = unpinButton.getAttribute('data-pinned-message-event')
			if (!channelId || !eventId || !hubStore.context.currentGroupId) return
			unpinButton.disabled = true
			await unpinMessage(hubStore.context.currentGroupId, channelId, eventId)
			hubStore.context.currentState = await getGroupState(hubStore.context.currentGroupId)
			refreshPinsBookmarks()
			refreshChannelPinsBar()
			unpinButton.disabled = false
		})
	})

	const bookmarks = await getChatBookmarks().catch(() => [])
	const valid = bookmarks.filter(b => b && (b.groupId || b.href))
	setPopCount('hub-bookmarks-count', valid.length)
	bookmarksHost.replaceChildren()
	if (!valid.length) {
		if (pinEntries.length)
			await mountTemplate(bookmarksHost, 'hub/nav/side_muted', { i18nKey: 'chat.hub.noBookmarks' })
		return
	}

	// 仅收录可解析的真实群名（name 与 groupId 不同），避免侧栏出现裸 UUID。
	const realGroupNames = new Map(hubStore.sidebar.groups
		.filter(g => g?.groupId && g.name && g.name !== g.groupId)
		.map(g => [normGroupId(g.groupId), g.name]))
	const currentKey = normGroupId(hubStore.context.currentGroupId)

	const rows = valid.map(bookmark => ({
		bookmark,
		eventId: String(bookmark.eventId || '').trim(),
		channelId: String(bookmark.channelId || '').trim(),
		targetGroup: bookmark.groupId || hubStore.context.currentGroupId,
	}))
	const labels = await Promise.all(rows.map(async ({ bookmark, eventId, channelId, targetGroup }) => {
		if (eventId && channelId && targetGroup) {
			const preview = await resolvePinMessagePreview(targetGroup, channelId, eventId)
			if (preview?.i18n) return { text: '', i18n: true }
			if (preview?.text?.trim()) return { text: compactSidebarText(preview.text), i18n: false }
		}
		if (bookmark.title?.trim()) return { text: compactSidebarText(bookmark.title), i18n: false }
		if (eventId) return { text: compactSidebarText(eventId.slice(0, 12)), i18n: false }
		return { text: '', i18n: true }
	}))

	for (const [index, { bookmark, eventId, channelId, targetGroup }] of rows.entries()) {
		const label = labels[index] || { text: '', i18n: true }
		const titleI18nAttr = label.i18n ? ' data-i18n="chat.hub.bookmarkFallback"' : ''
		const title = label.i18n ? '' : escapeHtml(label.text)
		const isOtherGroup = !!targetGroup && normGroupId(targetGroup) !== currentKey
		const groupName = isOtherGroup ? realGroupNames.get(normGroupId(targetGroup)) || '' : ''
		const channelName = channelId
			? hubStore.context.currentState?.channels?.[channelId]?.name || (isOtherGroup ? '' : channelId)
			: ''
		const meta = escapeHtml(compactSidebarText([groupName, channelName].filter(Boolean).join(' · '), 40))
		if (eventId || channelId) {
			const dataAttrs = [
				channelId ? ` data-bookmark-channel="${escapeHtml(channelId)}"` : '',
				eventId ? ` data-bookmark-event="${escapeHtml(eventId)}"` : '',
				targetGroup ? ` data-bookmark-group="${escapeHtml(targetGroup)}"` : '',
			].join('')
			const line = await renderTemplate('hub/bookmarks/row_button', { title, titleI18nAttr, meta, dataAttrs })
			line.querySelector('.hub-bookmark-row')?.addEventListener('click', async () => {
				if (targetGroup && targetGroup !== hubStore.context.currentGroupId)
					await selectGroup(targetGroup, channelId || undefined)
				else if (channelId && channelId !== hubStore.context.currentChannelId)
					await selectChannel(channelId)
				if (eventId) await scrollToMessageEventId(eventId)
			})
			line.querySelector('.hub-bookmark-remove')?.addEventListener('click', async clickEvent => {
				clickEvent.stopPropagation()
				await removeChatBookmark({ groupId: targetGroup, eventId })
				await refreshPinsBookmarks()
			})
			bookmarksHost.appendChild(line)
		}
		else {
			const href = bookmark.href?.trim()
				|| `#group:${encodeURIComponent(targetGroup || hubStore.context.currentGroupId)}:${encodeURIComponent(hubStore.context.currentChannelId || 'default')}`
			const line = await renderTemplate('hub/bookmarks/row_link', { href, title, titleI18nAttr, meta })
			line.querySelector('.hub-bookmark-remove')?.addEventListener('click', async clickEvent => {
				clickEvent.stopPropagation()
				clickEvent.preventDefault()
				await removeChatBookmark({ href })
				await refreshPinsBookmarks()
			})
			bookmarksHost.appendChild(line)
		}
	}
}

/** @type {Array<{ button: string, panel: string }>} 顶栏弹出按钮与其面板的对应 */
const POP_DEFS = [
	{ button: 'hub-pins-button', panel: 'hub-pins-panel' },
	{ button: 'hub-bookmarks-button', panel: 'hub-bookmarks-panel' },
]

/** 关闭所有顶栏置顶/书签弹出面板。 @returns {void} */
function closeAllPinsBookmarksPanels() {
	for (const { button, panel } of POP_DEFS) {
		document.getElementById(panel)?.setAttribute('hidden', '')
		const buttonElement = document.getElementById(button)
		buttonElement?.classList.remove('is-open')
		buttonElement?.setAttribute('aria-expanded', 'false')
	}
}

/**
 * 切换某个弹出面板，并收起另一个。
 * @param {string} buttonId 触发按钮 id
 * @param {string} panelId 面板 id
 * @returns {void}
 */
function togglePinsBookmarksPanel(buttonId, panelId) {
	const panel = document.getElementById(panelId)
	const button = document.getElementById(buttonId)
	if (!panel || !button) return
	const willOpen = panel.hasAttribute('hidden')
	closeAllPinsBookmarksPanels()
	if (willOpen) {
		panel.removeAttribute('hidden')
		button.classList.add('is-open')
		button.setAttribute('aria-expanded', 'true')
	}
}

let pinsBookmarksPanelsWired = false

/** 绑定顶栏置顶/书签按钮的展开/收起交互（仅绑定一次）。 @returns {void} */
export function wirePinsBookmarksPanels() {
	if (pinsBookmarksPanelsWired) return
	pinsBookmarksPanelsWired = true
	for (const { button, panel } of POP_DEFS)
		document.getElementById(button)?.addEventListener('click', event => {
			event.stopPropagation()
			togglePinsBookmarksPanel(button, panel)
		})
	document.addEventListener('click', event => {
		if (event.target instanceof Element && event.target.closest('.hub-header-pop')) return
		closeAllPinsBookmarksPanels()
	})
	document.addEventListener('keydown', event => {
		if (event.key === 'Escape') closeAllPinsBookmarksPanels()
	})
}
