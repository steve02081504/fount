/**
 * 右键菜单。
 */
import { positionContextMenu } from '/scripts/components/positionContextMenu.mjs'
import { bindDismissOnDocumentInteraction } from '/scripts/components/contextMenuDismiss.mjs'

import {
	copySelection,
	createFolder,
	deleteSelection,
	downloadFolder,
	downloadSelection,
	onEntryOpen,
	pasteClipboard,
	renameSelection,
} from './entryActions.mjs'
import { invertSelection, selectAllEntries, selectedEntries, syncSelectionClasses } from './entryGrid.mjs'
import { goUp, openCurrentInNewWindow } from './navigation.mjs'
import { openProps } from './properties.mjs'
import { canWrite, cabinetStore, hasClipboard, hotkeys } from './state.mjs'

/** @type {(() => void) & { unbind?: () => void } | null} */
let dismissBinding = null

/**
 * @typedef {{ i18n: string, shortcut?: string, run: () => unknown, danger?: boolean }} MenuAction
 */

/**
 * @returns {MenuAction[]} undo/redo 项
 */
function historyMenuItems() {
	const { history, remoteEntityHash } = cabinetStore
	if (remoteEntityHash) return []
	/** @type {MenuAction[]} */
	const items = []
	if (history.canUndo())
		items.push({
			i18n: 'cabinet.undo',
			shortcut: hotkeys.undo,
			/**
			 * @returns {Promise<boolean>} 是否执行
			 */
			run: () => history.undo(),
		})
	if (history.canRedo())
		items.push({
			i18n: 'cabinet.redo',
			shortcut: hotkeys.redo,
			/**
			 * @returns {Promise<boolean>} 是否执行
			 */
			run: () => history.redo(),
		})
	return items
}

/**
 * @param {Array<MenuAction | false | null>} actions 原始动作（false=分隔，null=跳过）
 * @returns {Array<MenuAction | false>} 压平后的菜单项
 */
function compactMenuActions(actions) {
	/** @type {Array<MenuAction | false>} */
	const items = []
	for (const action of actions) {
		if (action == null) continue
		if (action === false) {
			if (items.length && items.at(-1) !== false) items.push(false)
			continue
		}
		items.push(action)
	}
	while (items[0] === false) items.shift()
	while (items.at(-1) === false) items.pop()
	return items
}

/**
 * @param {MenuAction} action 菜单项
 * @returns {HTMLButtonElement} 菜单按钮
 */
function renderMenuButton(action) {
	const button = document.createElement('button')
	button.type = 'button'
	button.setAttribute('role', 'menuitem')
	const label = document.createElement('span')
	label.dataset.i18n = action.i18n
	button.appendChild(label)
	if (action.shortcut) button.appendChild(document.createTextNode(` (${action.shortcut})`))
	if (action.danger) button.classList.add('text-error')
	/** @returns {void} 执行菜单项并关闭菜单 */
	button.onclick = () => {
		hideContextMenu()
		void action.run()
	}
	return button
}

/**
 * @returns {void}
 */
export function hideContextMenu() {
	dismissBinding?.unbind?.()
	dismissBinding = null
	document.getElementById('contextMenu').classList.add('hidden')
}

/**
 * @param {MouseEvent} event 事件
 * @param {object} [entry] 右击条目
 * @returns {void}
 */
export function showContextMenu(event, entry) {
	event.preventDefault()
	event.stopPropagation()
	const { selected, remoteEntityHash, entries, currentParentId, currentCabinet } = cabinetStore
	if (entry && !selected.has(entry.id)) {
		selected.clear()
		selected.add(entry.id)
		cabinetStore.rangeAnchor = entry.id
		syncSelectionClasses()
	}
	const rows = selectedEntries()
	const one = rows.length === 1
	const writable = canWrite()
	const hist = historyMenuItems()
	/** 不可用项直接省略，不用 disabled + 文案解释 */
	/** @type {Array<MenuAction | false | null>} */
	const actions = entry
		? [
			one ? {
				i18n: 'cabinet.open',
				/**
				 * @returns {unknown} 打开选中条目
				 */
				run: () => onEntryOpen(rows[0]),
			} : null,
			rows.some(row => row.kind === 'file' || row.kind === 'folder')
				? { i18n: 'cabinet.download', run: downloadSelection }
				: null,
			false,
			writable && one ? { i18n: 'cabinet.rename', shortcut: hotkeys.rename, run: renameSelection } : null,
			{
				i18n: 'cabinet.copy',
				shortcut: hotkeys.copy,
				/** @returns {void} 复制选中条目到剪贴板 */
				run: () => copySelection('copy'),
			},
			writable ? {
				i18n: 'cabinet.cut',
				shortcut: hotkeys.cut,
				/** @returns {void} 剪切选中条目 */
				run: () => copySelection('cut'),
			} : null,
			false,
			...hist,
			hist.length ? false : null,
			one ? { i18n: 'cabinet.properties', run: openProps } : null,
			writable ? { i18n: 'cabinet.delete', shortcut: hotkeys.delete, danger: true, run: deleteSelection } : null,
		]
		: [
			writable ? {
				i18n: 'cabinet.upload',
				/** @returns {void} 触发文件选择上传 */
				run: () => document.getElementById('fileInput').click(),
			} : null,
			writable ? {
				i18n: 'cabinet.uploadFolder',
				/** @returns {void} 触发文件夹选择上传 */
				run: () => document.getElementById('folderInput').click(),
			} : null,
			writable ? { i18n: 'cabinet.new.folder', run: createFolder } : null,
			{ i18n: 'cabinet.new.window', shortcut: hotkeys.newWindow, run: openCurrentInNewWindow },
			false,
			writable && hasClipboard() ? {
				i18n: 'cabinet.paste',
				shortcut: hotkeys.paste,
				/** @returns {Promise<void>} 粘贴剪贴板条目 */
				run: () => pasteClipboard(),
			} : null,
			writable && hasClipboard() ? {
				i18n: 'cabinet.pasteLink',
				shortcut: hotkeys.pasteLink,
				/** @returns {Promise<void>} 以链接形式粘贴 */
				run: () => pasteClipboard(true),
			} : null,
			false,
			...hist,
			hist.length ? false : null,
			entries.length ? { i18n: 'cabinet.selectAll', shortcut: hotkeys.selectAll, run: selectAllEntries } : null,
			entries.length ? { i18n: 'cabinet.invert', run: invertSelection } : null,
			currentParentId ? { i18n: 'cabinet.goUp', shortcut: hotkeys.goUp, run: goUp } : null,
			!remoteEntityHash
				? {
					i18n: 'cabinet.downloadZip',
					/** @returns {Promise<void>} 打包下载当前目录 */
					run: () => downloadFolder(currentParentId, currentCabinet?.name),
				}
				: null,
		]
	const menu = document.getElementById('contextMenu')
	menu.replaceChildren()
	for (const action of compactMenuActions(actions)) {
		if (action === false) {
			const separator = document.createElement('li')
			separator.setAttribute('role', 'separator')
			const hr = document.createElement('hr')
			hr.className = 'my-1 border-base-300'
			separator.appendChild(hr)
			menu.appendChild(separator)
			continue
		}
		const li = document.createElement('li')
		li.setAttribute('role', 'none')
		li.appendChild(renderMenuButton(action))
		menu.appendChild(li)
	}
	menu.classList.remove('hidden')
	positionContextMenu(menu, { x: event.clientX, y: event.clientY, minWidth: '12rem' })
	dismissBinding?.unbind?.()
	dismissBinding = bindDismissOnDocumentInteraction(hideContextMenu, {
		ignoreSelectors: ['#contextMenu'],
	})
}
