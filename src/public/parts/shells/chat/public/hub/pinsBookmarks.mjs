/**
 * 【文件】public/hub/pinsBookmarks.mjs
 * 【职责】置顶消息与聊天书签侧栏：拉取列表、取消置顶/删除书签并刷新 Hub 侧栏模板。
 * 【原理】`refreshPinsBookmarks` 更新 `#hub-pins-bookmarks-wrap` 内条目，配合 `banners.setPinsBookmarksWrapVisible`；条目摘要依赖 `pinPreview`；点击可跳转到对应消息事件。
 * 【数据结构】hubStore（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】../../../../scripts/template、../src/api/groupApi、banners、core/domUtils、core/state、groupNav、messages/messages、messages/pinPreview。
 */
import { mountTemplate, renderTemplate } from '../../../../scripts/template.mjs'
import {
	getChatBookmarks,
	getGroupState,
	removeChatBookmark,
	unpinMessage,
} from '../src/api/groupApi.mjs'

import { setPinsBookmarksWrapVisible, refreshChannelPinsBar } from './banners.mjs'
import { escapeHtml } from './core/domUtils.mjs'
import { hubStore } from './core/state.mjs'
import { selectChannel, selectGroup } from './groupNav.mjs'
import { scrollToMessageEventId } from './messages/messages.mjs'
import { pinPreviewTemplateFields, resolvePinMessagePreview } from './messages/pinPreview.mjs'

const SIDEBAR_LABEL_MAX = 56

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
	if (hubStore.currentMode !== 'groups' || !hubStore.currentGroupId || !hubStore.currentState?.isMember) {
		setPinsBookmarksWrapVisible(false)
		return
	}
	const pinsBy = hubStore.currentState.pinsByChannel || {}
	const pinEntries = []
	for (const [channelId, ids] of Object.entries(pinsBy)) {
		if (!Array.isArray(ids) || !ids.length) continue
		const channelName = hubStore.currentState.channels?.[channelId]?.name || channelId
		for (const eventId of ids) {
			if (!eventId) continue
			pinEntries.push({ channelId, channelName, eventId })
		}
	}
	const previews = await Promise.all(
		pinEntries.map(({ channelId, eventId }) =>
			resolvePinMessagePreview(hubStore.currentGroupId, channelId, eventId)),
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

	pinsHost.querySelectorAll('.hub-pinned-message-row').forEach(pinRow => {
		pinRow.addEventListener('click', async () => {
			const channelId = pinRow.getAttribute('data-pinned-message-channel')
			const eventId = pinRow.getAttribute('data-pinned-message-event')
			if (!channelId || !eventId) return
			if (channelId !== hubStore.currentChannelId) await selectChannel(channelId)
			await scrollToMessageEventId(eventId)
		})
	})
	pinsHost.querySelectorAll('.hub-pinned-message-unpin-button').forEach(unpinButton => {
		unpinButton.addEventListener('click', async (clickEvent) => {
			clickEvent.stopPropagation()
			const channelId = unpinButton.getAttribute('data-pinned-message-channel')
			const eventId = unpinButton.getAttribute('data-pinned-message-event')
			if (!channelId || !eventId || !hubStore.currentGroupId) return
			unpinButton.disabled = true
			await unpinMessage(hubStore.currentGroupId, channelId, eventId)
			hubStore.currentState = await getGroupState(hubStore.currentGroupId)
			refreshPinsBookmarks()
			refreshChannelPinsBar()
			unpinButton.disabled = false
		})
	})

	const bookmarks = await getChatBookmarks().catch(() => [])
	const valid = bookmarks.filter(b => b && (b.groupId || b.href))
	setPinsBookmarksWrapVisible(pinEntries.length > 0 || valid.length > 0)
	bookmarksHost.replaceChildren()
	if (!valid.length) {
		if (pinEntries.length)
			await mountTemplate(bookmarksHost, 'hub/nav/side_muted', { i18nKey: 'chat.hub.noBookmarks' })
		return
	}

	// 仅收录可解析的真实群名（name 与 groupId 不同），避免侧栏出现裸 UUID。
	const realGroupNames = new Map(hubStore.groups
		.filter(g => g?.groupId && g.name && g.name !== g.groupId)
		.map(g => [normGroupId(g.groupId), g.name]))
	const currentKey = normGroupId(hubStore.currentGroupId)

	const rows = valid.map(bookmark => ({
		bookmark,
		eventId: String(bookmark.eventId || '').trim(),
		channelId: String(bookmark.channelId || '').trim(),
		targetGroup: bookmark.groupId || hubStore.currentGroupId,
	}))
	const labels = await Promise.all(rows.map(async ({ bookmark, eventId, channelId, targetGroup }) => {
		if (eventId && channelId && targetGroup) {
			const preview = await resolvePinMessagePreview(targetGroup, channelId, eventId)
			if (preview?.i18n) return { text: '', i18n: true }
			return { text: compactSidebarText(preview?.text || eventId.slice(0, 12)), i18n: false }
		}
		if (bookmark.title) return { text: compactSidebarText(bookmark.title), i18n: false }
		if (eventId) return { text: compactSidebarText(eventId), i18n: false }
		return { text: '', i18n: true }
	}))

	for (const [index, { bookmark, eventId, channelId, targetGroup }] of rows.entries()) {
		const label = labels[index] || { text: '', i18n: true }
		const titleI18nAttr = label.i18n ? ' data-i18n="chat.hub.bookmarkFallback"' : ''
		const title = label.i18n ? '' : escapeHtml(label.text)
		const isOtherGroup = !!targetGroup && normGroupId(targetGroup) !== currentKey
		const groupName = isOtherGroup ? realGroupNames.get(normGroupId(targetGroup)) || '' : ''
		const channelName = channelId
			? hubStore.currentState?.channels?.[channelId]?.name || (isOtherGroup ? '' : channelId)
			: ''
		const meta = escapeHtml(compactSidebarText([groupName, channelName].filter(Boolean).join(' · '), 40))
		if (eventId || channelId) {
			const dataAttrs = [
				channelId ? ` data-bookmark-channel="${escapeHtml(channelId)}"` : '',
				eventId ? ` data-bookmark-event="${escapeHtml(eventId)}"` : '',
				targetGroup ? ` data-bookmark-group="${escapeHtml(targetGroup)}"` : '',
			].join('')
			const line = await renderTemplate('hub/bookmarks/row_button', { title, titleI18nAttr, meta, dataAttrs, escapeHtml })
			line.querySelector('.hub-bookmark-row')?.addEventListener('click', async () => {
				if (targetGroup && targetGroup !== hubStore.currentGroupId)
					await selectGroup(targetGroup, channelId || undefined)
				else if (channelId && channelId !== hubStore.currentChannelId)
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
				|| `#group:${encodeURIComponent(targetGroup || hubStore.currentGroupId)}:${encodeURIComponent(hubStore.currentChannelId || 'default')}`
			const line = await renderTemplate('hub/bookmarks/row_link', { href, title, titleI18nAttr, meta, escapeHtml })
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
