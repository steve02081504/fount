/**
 * 【文件】public/hub/channelContextMenu.mjs
 * 【职责】侧栏频道项右键菜单：重命名、删除、类型切换与打开线程等频道级操作入口。
 * 【原理】`showChannelContextMenu` 在频道行旁弹出定位菜单并绑定一次性点击处理；删除/切换频道后由 `selectChannel`/`loadMessages` 重建主栏消息视图。
 * 【数据结构】hubStore（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】打开频道时可能触发 `updateHash`（由 `groupNav.selectChannel` 完成）；../../../../scripts/i18n、../../../../scripts/template、../../../../scripts/toast、../src/api/groupApi、../src/api/groupChannel、core/state、groupNav。
 */
import { confirmI18n } from '../../../../scripts/i18n.mjs'
import { renderTemplate } from '../../../../scripts/template.mjs'
import { showToastI18n } from '../../../../scripts/toast.mjs'
import { getGroupState } from '../src/api/groupApi.mjs'
import {
	deleteChannel,
	setDefaultChannel,
	updateChannel,
} from '../src/api/groupChannel.mjs'

import { hubStore } from './core/state.mjs'
import { renderHubChannelSidebar, selectChannel } from './groupNav.mjs'

/** @type {HTMLElement | null} */
let openMenuEl = null

/** @returns {void} */
function dismissChannelContextMenu() {
	if (!openMenuEl) return
	openMenuEl.remove()
	openMenuEl = null
}

/**
 * @param {string} channelId 刚操作的频道 ID
 * @returns {Promise<void>}
 */
async function refreshChannelsAfterManage(channelId) {
	const groupId = hubStore.currentGroupId
	if (!groupId) return
	hubStore.currentState = await getGroupState(groupId)
	await renderHubChannelSidebar(hubStore.currentState)
	const stillExists = hubStore.currentState?.channels?.[channelId]
	if (hubStore.currentChannelId === channelId && !stillExists) {
		const fallback = hubStore.currentState?.groupSettings?.defaultChannelId || 'default'
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

	const groupId = hubStore.currentGroupId
	if (!groupId || !channelId) return

	const channel = hubStore.currentState?.channels?.[channelId]
	const channelName = channel?.name || channelId
	const caps = hubStore.currentState?.channelCaps?.[channelId]
	const defaultChannelId = hubStore.currentState?.groupSettings?.defaultChannelId || 'default'
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
	openMenuEl = menu

	/**
	 * 关闭频道右键菜单并移除文档级监听。
	 * @returns {void}
	 */
	const closeOnce = () => {
		dismissChannelContextMenu()
		document.removeEventListener('click', closeOnce, true)
		document.removeEventListener('contextmenu', closeOnce, true)
	}
	setTimeout(() => {
		document.addEventListener('click', closeOnce, true)
		document.addEventListener('contextmenu', closeOnce, true)
	}, 0)

	menu.querySelector('.hub-channel-menu-copy-link')?.addEventListener('click', async () => {
		const url = `${window.location.origin}/parts/shells:chat/hub/#group:${encodeURIComponent(groupId)}:${encodeURIComponent(channelId)}`
		await navigator.clipboard.writeText(url)
		showToastI18n('success', 'chat.hub.channelCtx.copyLinkDone')
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
			showToastI18n('success', 'chat.hub.channelCtx.renameOk')
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
			showToastI18n('success', 'chat.hub.channelCtx.setDefaultOk')
			await refreshChannelsAfterManage(channelId)
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.operationFailed', { error: error.message })
		}
		closeOnce()
	})

	menu.querySelector('.hub-channel-menu-delete')?.addEventListener('click', async () => {
		if (!confirmI18n('chat.hub.channelCtx.deleteConfirm', { name: channelName })) return
		try {
			await deleteChannel(groupId, channelId)
			showToastI18n('success', 'chat.hub.channelCtx.deleteOk')
			await refreshChannelsAfterManage(channelId)
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.operationFailed', { error: error.message })
		}
		closeOnce()
	})
}
