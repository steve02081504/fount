/**
 * 右键菜单。
 */
import { geti18n } from '/scripts/i18n/index.mjs'
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
 * @param {string} label i18n key
 * @param {string} [shortcut] 快捷键
 * @returns {string} 菜单文案
 */
function menuLabel(label, shortcut) {
	const text = geti18n(label) || label
	return shortcut ? `${text} (${shortcut})` : text
}

/**
 * @returns {{ label: string, run: () => unknown, danger?: boolean }[]} undo/redo 项
 */
function historyMenuItems() {
	const { history, remoteEntityHash } = cabinetStore
	if (remoteEntityHash) return []
	/** @type {{ label: string, run: () => unknown }[]} */
	const items = []
	if (history.canUndo())
		items.push({
			label: menuLabel('cabinet.undo', hotkeys.undo),
			/**
			 * @returns {Promise<boolean>} 是否执行
			 */
			run: () => history.undo(),
		})
	if (history.canRedo())
		items.push({
			label: menuLabel('cabinet.redo', hotkeys.redo),
			/**
			 * @returns {Promise<boolean>} 是否执行
			 */
			run: () => history.redo(),
		})
	return items
}

/**
 * @param {Array<object | false | null>} actions 原始动作（false=分隔，null=跳过）
 * @returns {Array<object | false>} 压平后的菜单项
 */
function compactMenuActions(actions) {
	/** @type {Array<object | false>} */
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
	const actions = entry
		? [
			one ? {
				label: menuLabel('cabinet.open'),
				/**
				 * @returns {unknown} 打开选中条目
				 */
				run: () => onEntryOpen(rows[0]),
			} : null,
			rows.some(row => row.kind === 'file' || row.kind === 'folder')
				? { label: menuLabel('cabinet.download'), run: downloadSelection }
				: null,
			false,
			writable && one ? { label: menuLabel('cabinet.rename', hotkeys.rename), run: renameSelection } : null,
			{
				label: menuLabel('cabinet.copy', hotkeys.copy),
				/** @returns {void} 复制选中条目到剪贴板 */
				run: () => copySelection('copy'),
			},
			writable ? {
				label: menuLabel('cabinet.cut', hotkeys.cut),
				/** @returns {void} 剪切选中条目 */
				run: () => copySelection('cut'),
			} : null,
			false,
			...hist,
			hist.length ? false : null,
			one ? { label: menuLabel('cabinet.properties'), run: openProps } : null,
			writable ? { label: menuLabel('cabinet.delete', hotkeys.delete), danger: true, run: deleteSelection } : null,
		]
		: [
			writable ? {
				label: menuLabel('cabinet.upload'),
				/** @returns {void} 触发文件选择上传 */
				run: () => document.getElementById('fileInput').click(),
			} : null,
			writable ? {
				label: menuLabel('cabinet.uploadFolder'),
				/** @returns {void} 触发文件夹选择上传 */
				run: () => document.getElementById('folderInput').click(),
			} : null,
			writable ? { label: menuLabel('cabinet.newFolder'), run: createFolder } : null,
			{ label: menuLabel('cabinet.newWindow', hotkeys.newWindow), run: openCurrentInNewWindow },
			false,
			writable && hasClipboard() ? {
				label: menuLabel('cabinet.paste', hotkeys.paste),
				/** @returns {Promise<void>} 粘贴剪贴板条目 */
				run: () => pasteClipboard(),
			} : null,
			writable && hasClipboard() ? {
				label: menuLabel('cabinet.pasteLink', hotkeys.pasteLink),
				/** @returns {Promise<void>} 以链接形式粘贴 */
				run: () => pasteClipboard(true),
			} : null,
			false,
			...hist,
			hist.length ? false : null,
			entries.length ? { label: menuLabel('cabinet.selectAll', hotkeys.selectAll), run: selectAllEntries } : null,
			entries.length ? { label: menuLabel('cabinet.invert'), run: invertSelection } : null,
			currentParentId ? { label: menuLabel('cabinet.goUp', hotkeys.goUp), run: goUp } : null,
			!remoteEntityHash
				? {
					label: menuLabel('cabinet.downloadZip'),
					/** @returns {Promise<void>} 打包下载当前目录 */
					run: () => downloadFolder(currentParentId, currentCabinet?.name),
				}
				: null,
		]
	const menu = document.querySelector('#contextMenu ul')
	menu.replaceChildren()
	for (const action of compactMenuActions(actions)) {
		if (action === false) {
			const separator = document.createElement('li')
			separator.setAttribute('role', 'none')
			const hr = document.createElement('hr')
			hr.className = 'my-1 border-base-300'
			separator.appendChild(hr)
			menu.appendChild(separator)
			continue
		}
		const li = document.createElement('li')
		li.setAttribute('role', 'none')
		const button = document.createElement('button')
		button.type = 'button'
		button.setAttribute('role', 'menuitem')
		button.textContent = action.label
		if (action.danger) button.classList.add('text-error')
		/** @returns {void} 执行菜单项并关闭菜单 */
		button.onclick = () => {
			hideContextMenu()
			void action.run()
		}
		li.appendChild(button)
		menu.appendChild(li)
	}
	const host = document.getElementById('contextMenu')
	host.classList.remove('hidden')
	positionContextMenu(host, { x: event.clientX, y: event.clientY, minWidth: '12rem' })
	dismissBinding?.unbind?.()
	dismissBinding = bindDismissOnDocumentInteraction(hideContextMenu, {
		ignoreSelectors: ['#contextMenu'],
	})
}
