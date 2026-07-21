/**
 * 右键菜单。
 */
import { geti18n } from '/scripts/i18n/index.mjs'

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
	/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-returns -- context menu action callbacks */
	/** 不可用项直接省略，不用 disabled + 文案解释 */
	const actions = entry
		? [
			one ? { label: menuLabel('cabinet.open'), run: () => onEntryOpen(rows[0]) } : null,
			rows.some(row => row.kind === 'file' || row.kind === 'folder')
				? { label: menuLabel('cabinet.download'), run: downloadSelection }
				: null,
			false,
			writable && one ? { label: menuLabel('cabinet.rename', hotkeys.rename), run: renameSelection } : null,
			{ label: menuLabel('cabinet.copy', hotkeys.copy), run: () => copySelection('copy') },
			writable ? { label: menuLabel('cabinet.cut', hotkeys.cut), run: () => copySelection('cut') } : null,
			false,
			...hist,
			hist.length ? false : null,
			one ? { label: menuLabel('cabinet.properties'), run: openProps } : null,
			writable ? { label: menuLabel('cabinet.delete', hotkeys.delete), danger: true, run: deleteSelection } : null,
		]
		: [
			writable ? { label: menuLabel('cabinet.upload'), run: () => document.getElementById('fileInput').click() } : null,
			writable ? { label: menuLabel('cabinet.uploadFolder'), run: () => document.getElementById('folderInput').click() } : null,
			writable ? { label: menuLabel('cabinet.newFolder'), run: createFolder } : null,
			{ label: menuLabel('cabinet.newWindow', hotkeys.newWindow), run: openCurrentInNewWindow },
			false,
			writable && hasClipboard() ? { label: menuLabel('cabinet.paste', hotkeys.paste), run: () => pasteClipboard() } : null,
			writable && hasClipboard() ? { label: menuLabel('cabinet.pasteLink', hotkeys.pasteLink), run: () => pasteClipboard(true) } : null,
			false,
			...hist,
			hist.length ? false : null,
			entries.length ? { label: menuLabel('cabinet.selectAll', hotkeys.selectAll), run: selectAllEntries } : null,
			entries.length ? { label: menuLabel('cabinet.invert'), run: invertSelection } : null,
			currentParentId ? { label: menuLabel('cabinet.goUp', hotkeys.goUp), run: goUp } : null,
			!remoteEntityHash
				? { label: menuLabel('cabinet.downloadZip'), run: () => downloadFolder(currentParentId, currentCabinet?.name) }
				: null,
		]
	/* eslint-enable jsdoc/require-jsdoc, jsdoc/require-returns */
	const menu = document.querySelector('#contextMenu ul')
	menu.replaceChildren()
	for (const action of compactMenuActions(actions)) {
		if (action === false) {
			const separator = document.createElement('li')
			separator.className = 'menu-separator'
			menu.appendChild(separator)
			continue
		}
		const li = document.createElement('li')
		const button = document.createElement('button')
		button.type = 'button'
		button.textContent = action.label
		if (action.danger) button.classList.add('text-error')
		/**
		 *
		 */
		button.onclick = () => {
			hideContextMenu()
			void action.run()
		}
		li.appendChild(button)
		menu.appendChild(li)
	}
	const host = document.getElementById('contextMenu')
	host.classList.remove('hidden')
	const left = Math.min(event.clientX, window.innerWidth - host.offsetWidth - 8)
	const top = Math.min(event.clientY, window.innerHeight - host.offsetHeight - 8)
	host.style.left = `${Math.max(8, left)}px`
	host.style.top = `${Math.max(8, top)}px`
}
