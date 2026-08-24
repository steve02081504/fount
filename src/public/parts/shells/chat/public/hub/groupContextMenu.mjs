/**
 * 【文件】public/hub/groupContextMenu.mjs
 * 【职责】群组侧栏项与顶栏群组菜单：离开群、邀请、联邦入口、文件夹操作等上下文动作。
 * 【原理】`showGroupContextMenu` / `showGroupHeaderMenu` 弹出单例菜单层并处理 dismiss；离开或删除群后清空消息区；本模块不渲染气泡。
 * 【数据结构】store（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】../../../../scripts/i18n、../../../../scripts/parts、../../../../scripts/template、../../../../scripts/toast、../src/endpoints/groupCore、../src/inviteQr、chat、core/domUtils。
 */
import { getPartList } from '../../../../scripts/endpoints/parts.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { confirmI18n } from '../../../../scripts/i18n/index.mjs'
import { aliasForGroup, setGroupAlias } from '../shared/aliases.mjs'
import { promptText } from '/scripts/features/promptDialog.mjs'
import { addGroupChar, createGroupInvite, leaveGroups } from '../src/endpoints/groupCore.mjs'
import { buildInviteJoinShareUrl } from '../src/inviteQr.mjs'
import { openDialogFromTemplate, renderTemplate, renderTemplateAsHtmlString } from '../src/templates.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'

import { bindDismissOnDocumentInteraction } from '/scripts/components/contextMenuDismiss.mjs'
import { groupDisplayName } from './core/domUtils.mjs'
import { positionContextMenu } from '/scripts/components/positionContextMenu.mjs'
import { store } from './core/state.mjs'
import { getSidebarGroups } from './friendBindings.mjs'
import { clearGroupSelection, contextMenuTargetGroupIds } from './groupSelection.mjs'
import { openGroupNotifyPrefsDialog } from './notifyPrefsDialog.mjs'
import { clearPrivateGroupState } from './privateGroup.mjs'
import { loadGroups, renderServerBar } from './serverBar.mjs'
import { navigateToGroupSettings, selectGroup } from './sidebar/index.mjs'
import { closeGroupWebSocket } from './stream/index.mjs'

/** @type {HTMLElement | null} */
let openMenuElement = null
/** @type {(ReturnType<typeof bindDismissOnDocumentInteraction>) | null} */
let menuDismissClose = null

/** 关闭已打开的群操作菜单。 @returns {void} */
export function dismissGroupActionMenu() {
	menuDismissClose?.unbind()
	menuDismissClose = null
	if (!openMenuElement) return
	openMenuElement.remove()
	openMenuElement = null
}

/**
 * @param {Set<string>} leaving 待退出群 ID 集合
 * @returns {void}
 */
function pruneGroupFoldersAfterLeave(leaving) {
	for (const folder of store.sidebar.groupFoldersState.folders || [])
		folder.groupIds = (folder.groupIds || []).filter(id => !leaving.has(id))
}

/**
 * @param {string[]} groupIds 群 ID 列表
 * @returns {void}
 */
function markGroupsLeaving(groupIds) {
	const leaving = new Set(groupIds)
	for (const group of store.sidebar.groups)
		if (leaving.has(group.groupId))
			group.isLeaving = true
}

/**
 * @param {string[]} groupIds 群 ID 列表
 * @returns {void}
 */
function clearGroupsLeaving(groupIds) {
	const leaving = new Set(groupIds)
	for (const group of store.sidebar.groups)
		if (leaving.has(group.groupId))
			delete group.isLeaving
}

/**
 * @param {string[]} groupIds 群 ID 列表
 * @returns {void}
 */
function removeGroupsFromStore(groupIds) {
	const leaving = new Set(groupIds)
	store.sidebar.groups = store.sidebar.groups.filter(g => !leaving.has(g.groupId))
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
		id => id === store.context.currentGroupId || id === store.privateGroup.groupId,
	)
	if (touchesCurrent) closeGroupWebSocket()
	if (touchesCurrent) {
		if (store.privateGroup.groupId && leaving.has(store.privateGroup.groupId))
			clearPrivateGroupState()
		// 退群前刷新群列表：确保好友绑定群的 friendBinding 是最新值（否则 DM 群会被当作普通群选中）。
		await loadGroups().catch(handleError('chat.hub.load.groupFailed'))
		const next = getSidebarGroups().map(g => g.groupId).find(id => !leaving.has(id))
		if (next) await selectGroup(next)
		else {
			store.context.currentGroupId = null
			store.context.currentChannelId = null
			store.context.currentState = null
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
					showToastI18n('success', 'chat.hub.group.context.leave.batchOk', { count: ids.length })
				else showToastI18n('success', 'chat.hub.group.context.leave.ok')
				return
			}
			showToastI18n('warning', 'chat.hub.group.context.leave.batchPartial', {
				failed: failed.length,
				total: ids.length,
			})
		}
		catch (error) {
			clearGroupsLeaving(ids)
			await renderServerBar()
			handleError('chat.hub.load.groupFailed')(error)
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
		showToastI18n('info', 'chat.hub.group.context.leave.batchPending', { count: groupIds.length })
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
	const group = store.sidebar.groups.find(g => g.groupId === groupId)
	const groupName = group?.name || groupId

	const menu = document.createElement('ul')
	menu.className = 'menu menu-sm bg-base-100 rounded-box shadow-lg border border-base-300 p-1 z-50'
	if (batch) {
		const { setElementI18n } = await import('../../../../scripts/i18n/index.mjs')
		const li = document.createElement('li')
		const button = document.createElement('button')
		button.type = 'button'
		button.className = 'group-menu-leave-batch text-error'
		setElementI18n(button, 'chat.hub.group.context.leave.batch', { count: targets.length })
		li.appendChild(button)
		menu.appendChild(li)
	}
	else menu.appendChild(await renderTemplate('hub/modals/group_context_menu', { groupId }))
	document.body.appendChild(menu)
	positionContextMenu(menu, { x: left, y: top, maxWidth: 200 })
	openMenuElement = menu

	menuDismissClose = bindDismissOnDocumentInteraction(dismissGroupActionMenu)

	menu.querySelector('.group-menu-manage')?.addEventListener('click', () => {
		dismissGroupActionMenu()
		navigateToGroupSettings(groupId)
	})

	menu.querySelector('.group-menu-notify')?.addEventListener('click', () => {
		dismissGroupActionMenu()
		void openGroupNotifyPrefsDialog(groupId)
	})

	menu.querySelector('.group-menu-invite')?.addEventListener('click', async () => {
		dismissGroupActionMenu()
		try {
			const ticket = await createGroupInvite(groupId)
			const url = ticket.clipboardText
				|| buildInviteJoinShareUrl(
					groupId,
					ticket.code,
					ticket.roomSecret,
					ticket.introducerPubKeyHash,
					ticket.introducerNodeHash,
				)
			await navigator.clipboard.writeText(url)
			showToastI18n('success', 'chat.hub.group.context.inviteCopied')
		}
		catch (err) {
			handleError('chat.hub.shareGroupFailed')(err)
		}
	})

	menu.querySelector('.group-menu-add-char')?.addEventListener('click', async () => {
		dismissGroupActionMenu()
		await showAddCharDialog(groupId)
	})

	menu.querySelector('.group-menu-alias')?.addEventListener('click', () => {
		dismissGroupActionMenu()
		void (async () => {
			const next = await promptText(
				'chat.hub.group.context.setAliasPrompt',
				aliasForGroup(groupId),
				{ name: groupName },
			)
			if (next == null) return
			await setGroupAlias(groupId, next)
			showToastI18n('success', 'chat.hub.group.context.aliasSaved')
			await renderServerBar()
			if (store.context.currentGroupId === groupId) {
				const nameElement = document.getElementById('group-name-display')
				if (nameElement) {
					delete nameElement.dataset.i18n
					nameElement.textContent = await groupDisplayName(groupId, group?.name)
				}
			}
		})().catch(error => {
			showToastI18n('error', 'chat.hub.operationFailed', { error: error.message })
		})
	})

	menu.querySelector('.group-menu-leave-batch')?.addEventListener('click', async () => {
		dismissGroupActionMenu()
		if (!confirmI18n('chat.hub.group.context.leave.confirmBatch', { count: targets.length }))
			return
		await leaveGroupsOptimistic(targets)
	})

	menu.querySelector('.group-menu-leave')?.addEventListener('click', async () => {
		dismissGroupActionMenu()
		if (!confirmI18n('chat.hub.group.context.leave.confirm', { name: groupName }))
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
 * @param {HTMLElement} anchorElement `#group-header`
 * @returns {Promise<void>}
 */
export async function showGroupHeaderMenu(anchorElement) {
	const groupId = store.context.currentGroupId
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
		showToastI18n('warning', 'chat.hub.group.context.noChars')
		return
	}
	await openDialogFromTemplate('hub/modals/add_char', {}, {
		/**
		 * @param {HTMLDialogElement} dialog 对话框
		 * @returns {Promise<void>}
		 */
		onReady: async dialog => {
			const select = dialog.querySelector('#add-char-select')
			if (select instanceof HTMLSelectElement)
				select.innerHTML = await renderTemplateAsHtmlString('hub/modals/char_select_options', { chars })
			/** @returns {void} */
			const closeModal = () => dialog.close()
			dialog.querySelector('.add-char-cancel')?.addEventListener('click', closeModal)
			dialog.querySelector('.add-char-submit')?.addEventListener('click', async () => {
				const sel = dialog.querySelector('#add-char-select')
				const charname = sel instanceof HTMLSelectElement ? sel.value : ''
				if (!charname) return
				try {
					await addGroupChar(groupId, { charname })
					showToastI18n('success', 'chat.dragAndDrop.charAdded', { partName: charname })
					closeModal()
				}
				catch (err) {
					handleError('chat.hub.operationFailed')(err)
				}
			})
		},
	})
}
