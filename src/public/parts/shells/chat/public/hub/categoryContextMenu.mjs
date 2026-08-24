/**
 * 【文件】public/hub/categoryContextMenu.mjs
 * 【职责】频道列表空白区 / 分类头的右键菜单：新建频道、新建分类，及分类的创建/重命名/删除/权限入口。
 */
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { confirmAction, promptText } from '/scripts/features/promptDialog.mjs'
import { bindDismissOnDocumentInteraction } from '/scripts/components/contextMenuDismiss.mjs'
import { positionContextMenu } from '/scripts/components/positionContextMenu.mjs'
import { updateChannel, deleteChannel } from '../src/endpoints/groupChannel.mjs'

import { store } from './core/state.mjs'
import { showCreateCategoryModal } from './sidebar/createCategory.mjs'
import { refreshChannelSidebar, showCreateChannelModal } from './sidebar/createChannel.mjs'

/** @type {HTMLElement | null} */
let openMenuElement = null

/** @returns {void} */
function dismiss() {
	if (!openMenuElement) return
	openMenuElement.remove()
	openMenuElement = null
}

/**
 * 判断当前 viewer 是否可管理频道（任一频道 canEditList 即视为可管理）。
 * @param {object} [state] 群组状态
 * @returns {boolean} 是否可管理
 */
export function canEditChannelList(state = store.context.currentState) {
	return Object.values(state?.channelCaps || {}).some(capability => capability?.canEditList)
}

/**
 * 执行一次分类变更并刷新侧栏；成功后提示，fount 故障交给 handleError。
 * @param {() => Promise<unknown>} mutation 分类变更操作
 * @param {string} successKey 成功 toast 的 i18n 键
 * @returns {Promise<void>}
 */
async function applyCategoryMutation(mutation, successKey) {
	try {
		await mutation()
		showToastI18n('success', successKey)
		await refreshChannelSidebar()
	}
	catch (error) {
		handleError('chat.hub.operationFailed')(error)
	}
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
	if (!canEditChannelList()) return
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
	const canManageChannels = canEditChannelList()
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
		void showCreateChannelModal({ parentChannelId: categoryId })
	})
	menu.querySelector('[data-action="rename-category"]')?.addEventListener('click', () => {
		close()
		void (async () => {
			const next = await promptText('chat.hub.category.context.renamePrompt', categoryName, { name: categoryName })
			if (next == null) return
			const trimmed = next.trim()
			if (!trimmed || trimmed === categoryName) return
			await applyCategoryMutation(
				() => updateChannel(groupId, categoryId, { name: trimmed }),
				'chat.hub.category.context.renameOk',
			)
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
			if (!await confirmAction('chat.hub.category.context.deleteConfirm', { name: categoryName })) return
			await applyCategoryMutation(
				() => deleteChannel(groupId, categoryId),
				'chat.hub.category.context.deleteOk',
			)
		})()
	})
}
