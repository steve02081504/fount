/**
 * 【文件】public/hub/folderContextMenu.mjs
 * 【职责】左侧服务器栏「群组文件夹」的右键菜单：重命名、折叠/展开、解散文件夹。
 * 【原理】`showFolderContextMenu` 在点击位置挂一个单例菜单层，操作后改写 `hubStore.groupFoldersState.folders`，
 *   再 `persistGroupFolders` + `renderServerBar`（动态 import 规避与 serverBar 的循环依赖）。解散即把成员群移出文件夹。
 * 【数据结构】folder：{ id, name, nameIsDefault, groupIds[], collapsed }。
 * 【关联】../../../../scripts/i18n、serverBar、core/state。
 */
import { geti18n, promptI18n } from '../../../../scripts/i18n/index.mjs'

import { hubStore } from './core/state.mjs'

/** @type {HTMLElement | null} */
let openMenuEl = null

/** 关闭已打开的文件夹菜单。 @returns {void} */
export function dismissFolderContextMenu() {
	if (!openMenuEl) return
	openMenuEl.remove()
	openMenuEl = null
}

/**
 * 应用文件夹变更：持久化 + 重绘。
 * @returns {Promise<void>}
 */
async function commit() {
	const { persistGroupFolders, renderServerBar } = await import('./serverBar.mjs')
	await persistGroupFolders()
	await renderServerBar()
}

/**
 * 创建一个菜单项按钮。
 * @param {string} label 文案
 * @param {() => void} onClick 点击回调
 * @param {string} [extraClass] 额外 class
 * @returns {HTMLLIElement} 菜单项
 */
function menuItem(label, onClick, extraClass = '') {
	const li = document.createElement('li')
	const button = document.createElement('button')
	button.type = 'button'
	button.className = extraClass
	button.textContent = label
	button.addEventListener('click', onClick)
	li.appendChild(button)
	return li
}

/**
 * 在指定位置弹出文件夹右键菜单。
 * @param {MouseEvent} event 右键事件
 * @param {number} folderIndex 文件夹下标
 * @returns {void}
 */
export function showFolderContextMenu(event, folderIndex) {
	event.preventDefault()
	event.stopPropagation()
	dismissFolderContextMenu()

	const folder = hubStore.groupFoldersState.folders?.[folderIndex]
	if (!folder) return

	const menu = document.createElement('ul')
	menu.className = 'menu menu-sm bg-base-100 rounded-box shadow-lg border border-base-300 p-1 z-50'
	const menuWidth = 200
	const left = Math.min(event.clientX, window.innerWidth - menuWidth - 8)
	const top = Math.min(event.clientY, window.innerHeight - 8)
	menu.style.cssText = `position:fixed;left:${Math.max(8, left)}px;top:${Math.max(8, top)}px;min-width:9rem;max-width:${menuWidth}px;`

	menu.appendChild(menuItem(geti18n('chat.hub.folderRename'), async () => {
		dismissFolderContextMenu()
		const next = promptI18n('chat.hub.folderRenamePrompt', { name: folder.name || '' })
		if (next == null) return
		folder.name = String(next).trim()
		folder.nameIsDefault = !folder.name
		await commit()
	}))

	menu.appendChild(menuItem(
		geti18n(folder.collapsed ? 'chat.hub.folderExpand' : 'chat.hub.folderCollapse'),
		async () => {
			dismissFolderContextMenu()
			folder.collapsed = !folder.collapsed
			await commit()
		},
	))

	menu.appendChild(menuItem(geti18n('chat.hub.folderDissolve'), async () => {
		dismissFolderContextMenu()
		hubStore.groupFoldersState.folders = (hubStore.groupFoldersState.folders || [])
			.filter(item => item !== folder)
		await commit()
	}, 'text-error'))

	document.body.appendChild(menu)
	openMenuEl = menu

	/** @returns {void} */
	const closeOnce = () => {
		dismissFolderContextMenu()
		document.removeEventListener('click', closeOnce, true)
		document.removeEventListener('contextmenu', closeOnce, true)
	}
	setTimeout(() => {
		document.addEventListener('click', closeOnce, true)
		document.addEventListener('contextmenu', closeOnce, true)
	}, 0)
}
