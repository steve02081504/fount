/**
 * 【文件】public/hub/groupContextMenu.mjs
 * 【职责】群组侧栏项与顶栏群组菜单：离开群、邀请、联邦入口、文件夹操作等上下文动作。
 * 【原理】`showGroupContextMenu` / `showGroupHeaderMenu` 弹出单例菜单层并处理 dismiss；离开或删除群后清空消息区；本模块不渲染气泡。
 * 【数据结构】hubStore（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】../../../../scripts/i18n、../../../../scripts/parts、../../../../scripts/template、../../../../scripts/toast、../src/api/groupApi、../src/inviteQr、chat、core/domUtils。
 */
import { getPartList } from '../../../../scripts/api/parts.mjs'
import { openDialogFromTemplate } from '../../../../scripts/features/dialog.mjs'
import {
	renderTemplate,
	renderTemplateAsHtmlString,
	usingTemplates,
} from '../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { confirmI18n } from '../../../../scripts/i18n/index.mjs'
import { createGroupInvite, groupRequest, leaveGroups } from '../src/api/groupApi.mjs'
import { buildInviteJoinShareUrl } from '../src/inviteQr.mjs'
import { handleUIError } from '../src/ui/errors.mjs'

import { hubStore } from './core/state.mjs'
import { navigateToGroupSettings, selectGroup } from './groupNav.mjs'
import { clearGroupSelection, contextMenuTargetGroupIds } from './groupSelection.mjs'
import { closeGroupWebSocket } from './groupStream.mjs'
import { clearPrivateGroupState } from './privateGroup.mjs'
import { renderServerBar } from './serverBar.mjs'

/** @type {HTMLElement | null} */
let openMenuElement = null

/** 关闭已打开的群操作菜单。 @returns {void} */
export function dismissGroupActionMenu() {
	if (!openMenuElement) return
	openMenuElement.remove()
	openMenuElement = null
}

/**
 * @param {Set<string>} leaving 待退出群 ID 集合
 * @returns {void}
 */
function pruneGroupFoldersAfterLeave(leaving) {
	for (const folder of hubStore.sidebar.groupFoldersState.folders || [])
		folder.groupIds = (folder.groupIds || []).filter(id => !leaving.has(id))
}

/**
 * @param {string[]} groupIds 群 ID 列表
 * @returns {void}
 */
function markGroupsLeaving(groupIds) {
	const leaving = new Set(groupIds)
	for (const group of hubStore.sidebar.groups)
		if (leaving.has(group.groupId))
			group.isLeaving = true
}

/**
 * @param {string[]} groupIds 群 ID 列表
 * @returns {void}
 */
function clearGroupsLeaving(groupIds) {
	const leaving = new Set(groupIds)
	for (const group of hubStore.sidebar.groups)
		if (leaving.has(group.groupId))
			delete group.isLeaving
}

/**
 * @param {string[]} groupIds 群 ID 列表
 * @returns {void}
 */
function removeGroupsFromStore(groupIds) {
	const leaving = new Set(groupIds)
	hubStore.sidebar.groups = hubStore.sidebar.groups.filter(g => !leaving.has(g.groupId))
}

/**
 * 乐观更新：标记退群中并切换当前会话（不移除列表项直至 API 成功）。
 * @param {string[]} groupIds 群 ID 列表
 * @returns {Promise<void>}
 */
async function applyLeaveGroupsLocal(groupIds) {
	const leaving = new Set(groupIds)
	markGroupsLeaving(groupIds)
	const touchesCurrent = [...leaving].some(
		id => id === hubStore.context.currentGroupId || id === hubStore.privateGroup.groupId,
	)
	if (touchesCurrent) closeGroupWebSocket()
	if (touchesCurrent) {
		if (hubStore.privateGroup.groupId && leaving.has(hubStore.privateGroup.groupId))
			clearPrivateGroupState()
		const next = hubStore.sidebar.groups.find(g => !leaving.has(g.groupId))?.groupId
		if (next) await selectGroup(next)
		else {
			hubStore.context.currentGroupId = null
			hubStore.context.currentChannelId = null
			hubStore.context.currentState = null
			const { setMode } = await import('./mode.mjs')
			await setMode('friends')
		}
	}
	clearGroupSelection()
	await renderServerBar()
}

/**
 * 后台批量退群 API；成功项移出列表，失败项清除 isLeaving。
 * @param {string[]} groupIds 群 ID 列表
 * @returns {void}
 */
function runLeaveGroupsInBackground(groupIds) {
	const ids = [...groupIds]
	const batch = ids.length > 1
	void (async () => {
		try {
			const { ok = [], failed = [] } = await leaveGroups(ids)
			const okSet = new Set(ok)
			const failedIds = failed.map(row => row.groupId)
			if (okSet.size) {
				removeGroupsFromStore([...okSet])
				pruneGroupFoldersAfterLeave(okSet)
			}
			clearGroupsLeaving(failedIds)
			await renderServerBar()
			if (!failed.length) {
				if (batch)
					showToastI18n('success', 'chat.hub.groupContext.leaveBatchOk', { count: ids.length })
				else showToastI18n('success', 'chat.hub.groupContext.leaveOk')
				return
			}
			showToastI18n('warning', 'chat.hub.groupContext.leaveBatchPartial', {
				failed: failed.length,
				total: ids.length,
			})
		}
		catch (error) {
			clearGroupsLeaving(ids)
			await renderServerBar()
			handleUIError(error, 'chat.hub.loadGroupFailed')
			const { loadGroups } = await import('./serverBar.mjs')
			await loadGroups()
		}
	})()
}

/**
 * 乐观退群：先更新 UI，再后台并行请求。
 * @param {string[]} groupIds 群 ID 列表
 * @returns {Promise<void>}
 */
export async function leaveGroupsOptimistic(groupIds) {
	await applyLeaveGroupsLocal(groupIds)
	if (groupIds.length > 1)
		showToastI18n('info', 'chat.hub.groupContext.leaveBatchPending', { count: groupIds.length })
	runLeaveGroupsInBackground(groupIds)
}

/**
 * 在指定坐标展示群操作菜单（设置、邀请等）。
 * @param {string} groupId 锚定群 ID
 * @param {number} left 视口 left（px）
 * @param {number} top 视口 top（px）
 * @param {string[]} [targetGroupIds] 菜单作用群（默认仅 groupId）
 * @returns {Promise<void>}
 */
async function mountGroupActionMenuAt(groupId, left, top, targetGroupIds = null) {
	dismissGroupActionMenu()

	const targets = targetGroupIds?.length ? targetGroupIds : [groupId]
	const batch = targets.length > 1
	const group = hubStore.sidebar.groups.find(g => g.groupId === groupId)
	const groupName = group?.name || groupId

	const menu = document.createElement('ul')
	menu.className = 'menu menu-sm bg-base-100 rounded-box shadow-lg border border-base-300 p-1 z-50'
	const menuWidth = 200
	const clampedLeft = Math.min(left, window.innerWidth - menuWidth - 8)
	const clampedTop = Math.min(top, window.innerHeight - 8)
	menu.style.cssText = `position:fixed;left:${Math.max(8, clampedLeft)}px;top:${Math.max(8, clampedTop)}px;min-width:10rem;max-width:${menuWidth}px;`
	if (batch) {
		const { geti18n } = await import('../../../../scripts/i18n/index.mjs')
		const li = document.createElement('li')
		const button = document.createElement('button')
		button.type = 'button'
		button.className = 'hub-group-menu-leave-batch text-error'
		button.textContent = await geti18n('chat.hub.groupContext.leaveBatch', { count: targets.length })
		li.appendChild(button)
		menu.appendChild(li)
	}
	else menu.appendChild(await renderTemplate('hub/modals/group_context_menu', { groupId }))
	document.body.appendChild(menu)
	openMenuElement = menu

	/**
	 * 关闭群右键菜单并移除文档级监听。
	 * @returns {void}
	 */
	const closeOnce = () => {
		dismissGroupActionMenu()
		document.removeEventListener('click', closeOnce, true)
		document.removeEventListener('contextmenu', closeOnce, true)
	}
	setTimeout(() => {
		document.addEventListener('click', closeOnce, true)
		document.addEventListener('contextmenu', closeOnce, true)
	}, 0)

	menu.querySelector('.hub-group-menu-manage')?.addEventListener('click', () => {
		dismissGroupActionMenu()
		navigateToGroupSettings(groupId)
	})

	menu.querySelector('.hub-group-menu-invite')?.addEventListener('click', async () => {
		dismissGroupActionMenu()
		try {
			const ticket = await createGroupInvite(groupId)
			const url = ticket.clipboardText
				|| buildInviteJoinShareUrl(
					groupId,
					ticket.code,
					ticket.roomSecret,
					ticket.introducerPubKeyHash,
				)
			await navigator.clipboard.writeText(url)
			showToastI18n('success', 'chat.hub.groupContext.inviteCopied')
		}
		catch (err) {
			handleUIError(err, 'chat.hub.shareGroupFailed')
		}
	})

	menu.querySelector('.hub-group-menu-add-char')?.addEventListener('click', async () => {
		dismissGroupActionMenu()
		await showAddCharDialog(groupId)
	})

	menu.querySelector('.hub-group-menu-leave-batch')?.addEventListener('click', async () => {
		dismissGroupActionMenu()
		if (!confirmI18n('chat.hub.groupContext.leaveConfirmBatch', { count: targets.length }))
			return
		await leaveGroupsOptimistic(targets)
	})

	menu.querySelector('.hub-group-menu-leave')?.addEventListener('click', async () => {
		dismissGroupActionMenu()
		if (!confirmI18n('chat.hub.groupContext.leaveConfirm', { name: groupName }))
			return
		await leaveGroupsOptimistic([groupId])
	})
}

/**
 * 在鼠标位置显示群右键菜单。
 * @param {MouseEvent} event 右键事件
 * @param {string} groupId 群 ID
 * @returns {Promise<void>}
 */
export async function showGroupContextMenu(event, groupId) {
	event.preventDefault()
	event.stopPropagation()
	await mountGroupActionMenuAt(groupId, event.clientX, event.clientY, contextMenuTargetGroupIds(groupId))
}

/**
 * 在群名标题下方显示群操作下拉菜单。
 * @param {HTMLElement} anchorElement `#hub-group-header`
 * @returns {Promise<void>}
 */
export async function showGroupHeaderMenu(anchorElement) {
	const groupId = hubStore.context.currentGroupId
	if (!groupId || !(anchorElement instanceof HTMLElement)) return
	const rect = anchorElement.getBoundingClientRect()
	await mountGroupActionMenuAt(groupId, rect.left, rect.bottom + 4)
}

/**
 * 弹出角色选择并加入群。
 * @param {string} groupId 群 ID
 * @returns {Promise<void>}
 */
async function showAddCharDialog(groupId) {
	let chars = []
	try {
		chars = await getPartList('chars')
	}
	catch {
		chars = []
	}
	if (!chars.length) {
		showToastI18n('warning', 'chat.hub.groupContext.noChars')
		return
	}
	usingTemplates('/parts/shells:chat/src/templates')
	await openDialogFromTemplate('hub/modals/add_char', {}, {
		/**
		 * @param {HTMLDialogElement} dialog 对话框
		 * @returns {Promise<void>}
		 */
		onReady: async dialog => {
			const select = dialog.querySelector('#hub-add-char-select')
			if (select instanceof HTMLSelectElement)
				select.innerHTML = await renderTemplateAsHtmlString('hub/modals/char_select_options', { chars })
			/** @returns {void} */
			const closeModal = () => dialog.close()
			dialog.querySelector('.hub-add-char-cancel')?.addEventListener('click', closeModal)
			dialog.querySelector('.hub-add-char-submit')?.addEventListener('click', async () => {
				const sel = dialog.querySelector('#hub-add-char-select')
				const charname = sel instanceof HTMLSelectElement ? sel.value.trim() : ''
				if (!charname) return
				try {
					await groupRequest(groupId, 'char', 'POST', { charname })
					showToastI18n('success', 'chat.dragAndDrop.charAdded', { partName: charname })
					closeModal()
				}
				catch (err) {
					handleUIError(err, 'chat.hub.operationFailed')
				}
			})
		},
	})
}
