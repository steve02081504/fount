/**
 * 【文件】public/hub/categoryContextMenu.mjs
 * 【职责】频道列表空白区 / 分类头的右键菜单：新建频道、新建分类，及分类的创建/重命名/删除/权限入口。
 */
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { confirmI18n } from '../../../../scripts/i18n/index.mjs'
import { promptText } from '/scripts/features/promptDialog.mjs'
import { bindDismissOnDocumentInteraction } from '/scripts/components/contextMenuDismiss.mjs'
import { positionContextMenu } from '/scripts/components/positionContextMenu.mjs'
import { deleteCategory, updateCategory } from '../src/endpoints/groupCategory.mjs'
import { getGroupState } from '../src/endpoints/groupCore.mjs'

import { store, setState } from './core/state.mjs'
import { showCreateCategoryModal } from './sidebar/createCategory.mjs'
import { showCreateChannelModal } from './sidebar/createChannel.mjs'

/** @type {HTMLElement | null} */
let openMenuElement = null

/** @returns {void} */
function dismiss() {
	if (!openMenuElement) return
	openMenuElement.remove()
	openMenuElement = null
}

/**
 * 分类变更后重新拉群状态并渲染侧栏。
 * @returns {Promise<void>}
 */
async function refreshSidebarAfterCategoryChange() {
	const groupId = store.context.currentGroupId
	if (!groupId) return
	setState('context.currentState', await getGroupState(groupId))
	const { renderHubChannelSidebar } = await import('./sidebar/index.mjs')
	await renderHubChannelSidebar(store.context.currentState)
}

/**
 * 弹出通用右键菜单容器。
 * @param {MouseEvent} event 右键事件
 * @param {string[]} items 菜单项 HTML
 * @returns {{ close: () => void, menu: HTMLUListElement }} 关闭函数与菜单
 */
function mountMenu(event, items) {
	event.preventDefault()
	event.stopPropagation()
	dismiss()
	const menu = document.createElement('ul')
	menu.className = 'menu menu-sm bg-base-100 rounded-box shadow-lg border border-base-300 p-1 z-50'
	menu.innerHTML = items.join('')
	document.body.appendChild(menu)
	positionContextMenu(menu, { x: event.clientX, y: event.clientY, minWidth: 192 })
	openMenuElement = menu
	return { close: bindDismissOnDocumentInteraction(dismiss), menu }
}

/**
 * 频道列表空白区右键菜单（创建频道 / 创建分类）。
 * @param {MouseEvent} event 右键事件
 * @returns {void}
 */
export function showChannelListCreateMenu(event) {
	const canManageChannels = Object.values(store.context.currentState?.channelCaps || {})
		.some(cap => cap?.canEditList)
	if (!canManageChannels) return
	const { close, menu } = mountMenu(event, [
		'<li><button type="button" class="w-full text-left" data-action="create-channel" data-i18n="chat.hub.newChannel.button"></button></li>',
		'<li><button type="button" class="w-full text-left" data-action="create-category" data-i18n="chat.hub.newCategory.button"></button></li>',
	])
	menu.querySelector('[data-action="create-channel"]')?.addEventListener('click', () => {
		close()
		void showCreateChannelModal()
	})
	menu.querySelector('[data-action="create-category"]')?.addEventListener('click', () => {
		close()
		void showCreateCategoryModal()
	})
}

/**
 * 分类头右键菜单（在此分类创建频道 / 重命名 / 删除 / 权限设置）。
 * @param {MouseEvent} event 右键事件
 * @param {string} categoryId 分类 ID
 * @param {string} categoryName 分类名
 * @returns {void}
 */
export function showCategoryContextMenu(event, categoryId, categoryName) {
	const groupId = store.context.currentGroupId
	if (!groupId || !categoryId) return
	const canManageChannels = Object.values(store.context.currentState?.channelCaps || {})
		.some(cap => cap?.canEditList)
	const { close, menu } = mountMenu(event, [
		'<li><button type="button" class="w-full text-left" data-action="create-in-category" data-i18n="chat.hub.category.context.createIn"></button></li>',
		canManageChannels
			? '<li><button type="button" class="w-full text-left" data-action="rename-category" data-i18n="chat.hub.category.context.rename"></button></li>'
			: '',
		canManageChannels
			? '<li><button type="button" class="w-full text-left" data-action="category-perms" data-i18n="chat.hub.category.context.perms"></button></li>'
			: '',
		canManageChannels
			? '<li><button type="button" class="w-full text-left text-error" data-action="delete-category" data-i18n="chat.hub.category.context.delete"></button></li>'
			: '',
	])
	menu.querySelector('[data-action="create-in-category"]')?.addEventListener('click', () => {
		close()
		void showCreateChannelModal({ category: categoryId })
	})
	menu.querySelector('[data-action="rename-category"]')?.addEventListener('click', () => {
		close()
		void (async () => {
			const next = await promptText('chat.hub.category.context.renamePrompt', categoryName, { name: categoryName })
			if (next == null) return
			const trimmed = next.trim()
			if (!trimmed || trimmed === categoryName) return
			try {
				await updateCategory(groupId, categoryId, { name: trimmed })
				showToastI18n('success', 'chat.hub.category.context.renameOk')
				await refreshSidebarAfterCategoryChange()
			}
			catch (error) {
				showToastI18n('error', 'chat.hub.operationFailed', { error: error.message })
			}
		})()
	})
	menu.querySelector('[data-action="category-perms"]')?.addEventListener('click', () => {
		close()
		void (async () => {
			const { showCategoryPermsDialog } = await import('./categoryPermsDialog.mjs')
			await showCategoryPermsDialog(groupId, categoryId, categoryName)
		})()
	})
	menu.querySelector('[data-action="delete-category"]')?.addEventListener('click', () => {
		close()
		void (async () => {
			if (!confirmI18n('chat.hub.category.context.deleteConfirm', { name: categoryName })) return
			try {
				await deleteCategory(groupId, categoryId)
				showToastI18n('success', 'chat.hub.category.context.deleteOk')
				await refreshSidebarAfterCategoryChange()
			}
			catch (error) {
				showToastI18n('error', 'chat.hub.operationFailed', { error: error.message })
			}
		})()
	})
}
