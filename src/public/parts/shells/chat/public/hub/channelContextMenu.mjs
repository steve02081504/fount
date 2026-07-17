/**
 * 【文件】public/hub/channelContextMenu.mjs
 * 【职责】侧栏频道项右键菜单：重命名、删除、类型切换与打开线程等频道级操作入口。
 * 【原理】`showChannelContextMenu` 在频道行旁弹出定位菜单并绑定一次性点击处理；删除/切换频道后由 `selectChannel`/`loadMessages` 重建主栏消息视图。
 * 【数据结构】hubStore（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】打开频道时可能触发 `updateHash`（由 `sidebar.selectChannel` 完成）；../../../../scripts/i18n、../../../../scripts/template、../../../../scripts/toast、../src/api/groupCore、groupChannel、core/state、sidebar。
 */
import { renderTemplate } from '../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { confirmI18n } from '../../../../scripts/i18n/index.mjs'
import {
	downloadChannelArchiveJson,
	exportChannelArchiveJson,
} from '../src/api/channelArchive.mjs'
import {
	deleteChannel,
	setDefaultChannel,
	updateChannel,
} from '../src/api/groupChannel.mjs'
import { getGroupState } from '../src/api/groupCore.mjs'
import { handleUIError } from '../src/ui/errors.mjs'

import { bindDismissOnDocumentInteraction } from './core/contextMenuDismiss.mjs'
import { hubStore } from './core/state.mjs'
import { openChannelNotifyPrefsDialog } from './notifyPrefsDialog.mjs'
import { renderHubChannelSidebar, selectChannel } from './sidebar/index.mjs'

/** @type {HTMLElement | null} */
let openMenuElement = null

/** @returns {void} */
function dismissChannelContextMenu() {
	if (!openMenuElement) return
	openMenuElement.remove()
	openMenuElement = null
}

/**
 * @param {string} channelId 刚操作的频道 ID
 * @returns {Promise<void>}
 */
async function refreshChannelsAfterManage(channelId) {
	const groupId = hubStore.context.currentGroupId
	if (!groupId) return
	hubStore.context.currentState = await getGroupState(groupId)
	await renderHubChannelSidebar(hubStore.context.currentState)
	const stillExists = hubStore.context.currentState?.channels?.[channelId]
	if (hubStore.context.currentChannelId === channelId && !stillExists) {
		const fallback = hubStore.context.currentState?.groupSettings?.defaultChannelId || 'default'
		await selectChannel(fallback)
	}
}

/**
 * @param {MouseEvent} event 右键事件
 * @param {string} channelId 频道 ID
 * @returns {Promise<void>}
 */
export async function showChannelContextMenu(event, channelId) {
	event.preventDefault()
	event.stopPropagation()
	dismissChannelContextMenu()

	const groupId = hubStore.context.currentGroupId
	if (!groupId || !channelId) return

	const channel = hubStore.context.currentState?.channels?.[channelId]
	const channelName = channel?.name || channelId
	const caps = hubStore.context.currentState?.channelCaps?.[channelId]
	const defaultChannelId = hubStore.context.currentState?.groupSettings?.defaultChannelId || 'default'
	const showRename = !!caps?.canEditList
	const showSetDefault = showRename && channelId !== defaultChannelId
	const showDelete = showRename

	const menu = document.createElement('ul')
	menu.className = 'menu menu-sm bg-base-100 rounded-box shadow-lg border border-base-300 p-1 z-50'
	menu.style.cssText = `position:fixed;left:${event.clientX}px;top:${event.clientY}px;min-width:10rem;`
	menu.appendChild(await renderTemplate('hub/nav/channel_context_menu', {
		channelId,
		showRename,
		showSetDefault,
		showDelete,
	}))
	document.body.appendChild(menu)
	openMenuElement = menu

	const closeOnce = bindDismissOnDocumentInteraction(dismissChannelContextMenu)

	menu.querySelector('.hub-channel-menu-notify')?.addEventListener('click', () => {
		closeOnce()
		void openChannelNotifyPrefsDialog(groupId, channelId)
	})

	menu.querySelector('.hub-channel-menu-copy-link')?.addEventListener('click', async () => {
		const url = `${window.location.origin}/parts/shells:chat/hub/#group:${encodeURIComponent(groupId)}:${encodeURIComponent(channelId)}`
		await navigator.clipboard.writeText(url)
		showToastI18n('success', 'chat.hub.channelContext.copyLinkDone')
		closeOnce()
	})

	menu.querySelector('.hub-channel-menu-rename')?.addEventListener('click', async () => {
		const next = window.prompt('', channelName)
		if (next == null) return
		const trimmed = next.trim()
		if (!trimmed || trimmed === channelName) {
			closeOnce()
			return
		}
		try {
			await updateChannel(groupId, channelId, { name: trimmed })
			showToastI18n('success', 'chat.hub.channelContext.renameOk')
			await refreshChannelsAfterManage(channelId)
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.operationFailed', { error: error.message })
		}
		closeOnce()
	})

	menu.querySelector('.hub-channel-menu-set-default')?.addEventListener('click', async () => {
		try {
			await setDefaultChannel(groupId, channelId)
			showToastI18n('success', 'chat.hub.channelContext.setDefaultOk')
			await refreshChannelsAfterManage(channelId)
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.operationFailed', { error: error.message })
		}
		closeOnce()
	})

	menu.querySelector('.hub-channel-menu-export')?.addEventListener('click', async () => {
		closeOnce()
		try {
			const archive = await exportChannelArchiveJson(groupId, channelId)
			const safeName = String(channelName || channelId).replace(/[^\w.-]+/g, '_').slice(0, 64)
			downloadChannelArchiveJson(archive, `channel-${safeName}.json`)
			showToastI18n('success', 'chat.hub.channelContext.exportOk')
		}
		catch (error) {
			handleUIError(error, 'chat.hub.channelContext.exportFailed')
		}
	})

	menu.querySelector('.hub-channel-menu-delete')?.addEventListener('click', async () => {
		if (!confirmI18n('chat.hub.channelContext.deleteConfirm', { name: channelName })) return
		try {
			await deleteChannel(groupId, channelId)
			showToastI18n('success', 'chat.hub.channelContext.deleteOk')
			await refreshChannelsAfterManage(channelId)
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.operationFailed', { error: error.message })
		}
		closeOnce()
	})
}
