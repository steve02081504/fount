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
	unpinMessage,
} from '../src/api/groupApi.mjs'

import { setPinsBookmarksWrapVisible, refreshChannelPinsBar } from './banners.mjs'
import { escapeHtml } from './core/domUtils.mjs'
import { hubStore } from './core/state.mjs'
import { selectChannel, selectGroup } from './groupNav.mjs'
import { loadMessages, scrollToMessageEventId } from './messages/messages.mjs'
import { pinPreviewTemplateFields, resolvePinMessagePreview } from './messages/pinPreview.mjs'

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
				channelName: escapeHtml(channelName),
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
	if (!valid.length) {
		if (!pinEntries.length) return
		await mountTemplate(bookmarksHost, 'hub/nav/side_muted', { i18nKey: 'chat.hub.noBookmarks' })
		return
	}
	const groupNames = new Map(hubStore.groups.filter(g => g?.groupId).map(g => [g.groupId, g.name || g.groupId]))
	for (const bookmark of valid)
		if (bookmark.groupId && !groupNames.has(bookmark.groupId))
			groupNames.set(bookmark.groupId, bookmark.groupId)

	const byGroup = new Map()
	for (const bookmark of valid) {
		const groupId = bookmark.groupId ?? null
		if (!byGroup.has(groupId)) byGroup.set(groupId, [])
		byGroup.get(groupId).push(bookmark)
	}
	bookmarksHost.replaceChildren()
	for (const [groupId, rows] of byGroup) {
		const label = groupId === null ? '' : escapeHtml(groupNames.get(groupId) || groupId)
		const groupI18nAttr = groupId === null ? ' data-i18n="chat.hub.bookmarkLocal"' : ''
		bookmarksHost.appendChild(await renderTemplate('hub/bookmarks/group_head', { label, groupI18nAttr }))
		const bookmarkRows = rows.map(bookmark => ({
			bookmark,
			eventId: String(bookmark.eventId || '').trim(),
			channelId: String(bookmark.channelId || '').trim(),
			targetGroup: bookmark.groupId || hubStore.currentGroupId,
		}))
	const bookmarkLabels = await Promise.all(bookmarkRows.map(async ({ bookmark, eventId, channelId, targetGroup }) => {
		if (eventId && channelId && targetGroup) {
			const preview = await resolvePinMessagePreview(targetGroup, channelId, eventId)
			if (preview?.i18n) return { text: '', i18n: true }
			return { text: preview?.text || eventId.slice(0, 12), i18n: false }
		}
		if (bookmark.title) return { text: bookmark.title, i18n: false }
		if (eventId) return { text: eventId, i18n: false }
		return { text: '', i18n: true }
	}))
		for (const [index, { bookmark, eventId, channelId, targetGroup }] of bookmarkRows.entries()) {
			const label = bookmarkLabels[index] || { text: '', i18n: true }
			const titleI18nAttr = label.i18n ? ' data-i18n="chat.hub.bookmarkFallback"' : ''
			const title = label.i18n ? '' : escapeHtml(label.text)
			if (eventId || channelId) {
				const dataAttrs = [
					channelId ? ` data-bookmark-channel="${escapeHtml(channelId)}"` : '',
					eventId ? ` data-bookmark-event="${escapeHtml(eventId)}"` : '',
					targetGroup ? ` data-bookmark-group="${escapeHtml(targetGroup)}"` : '',
				].join('')
				const bookmarkRow = await renderTemplate('hub/bookmarks/row_button', {
					title,
					titleI18nAttr,
					dataAttrs,
					escapeHtml,
				})
				bookmarkRow.addEventListener('click', async () => {
					const bookmarkGroup = bookmarkRow.getAttribute('data-bookmark-group')
					const bookmarkChannelId = bookmarkRow.getAttribute('data-bookmark-channel')
					const bookmarkEventId = bookmarkRow.getAttribute('data-bookmark-event')
					if (bookmarkGroup && bookmarkGroup !== hubStore.currentGroupId) 
						await selectGroup(bookmarkGroup, bookmarkChannelId || undefined)
					
					else if (bookmarkChannelId && bookmarkChannelId !== hubStore.currentChannelId)
						await selectChannel(bookmarkChannelId)
					else if (bookmarkChannelId) await loadMessages()
					if (bookmarkEventId) await scrollToMessageEventId(bookmarkEventId)
				})
				bookmarksHost.appendChild(bookmarkRow)
			}
			else {
				const href = bookmark.href?.trim()
					|| `#group:${encodeURIComponent(targetGroup || hubStore.currentGroupId)}:${encodeURIComponent(hubStore.currentChannelId || 'default')}`
				bookmarksHost.appendChild(await renderTemplate('hub/bookmarks/row_link', { href, title, titleI18nAttr, escapeHtml }))
			}
		}
	}
}
