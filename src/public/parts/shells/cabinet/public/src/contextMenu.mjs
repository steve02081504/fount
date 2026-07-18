/**
 * 右键菜单。
 */
import { geti18n } from '/scripts/i18n/index.mjs'

import { readClipboard } from './clipboard.mjs'
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
import { invertSelection, renderEntries, renderStatus, selectAllEntries, selectedEntries } from './entryGrid.mjs'
import { goUp, openCurrentInNewWindow, refreshEntries } from './navigation.mjs'
import { openProps } from './properties.mjs'
import { canWrite, cabinetStore, hotkeys } from './state.mjs'

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
	const { selected, history, remoteEntityHash, entries, currentParentId, currentCabinet } = cabinetStore
	if (entry && !selected.has(entry.id)) {
		selected.clear()
		selected.add(entry.id)
		cabinetStore.rangeAnchor = entry.id
		void renderEntries()
		renderStatus()
	}
	const rows = selectedEntries()
	const one = rows.length === 1
	const writable = canWrite()
	const hasClip = Boolean((cabinetStore.clipboard || readClipboard())?.entry_ids?.length)
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
			!remoteEntityHash && history.canUndo()
				? { label: menuLabel('cabinet.undo', hotkeys.undo), run: () => history.undo().then(() => refreshEntries()) }
				: null,
			!remoteEntityHash && history.canRedo()
				? { label: menuLabel('cabinet.redo', hotkeys.redo), run: () => history.redo().then(() => refreshEntries()) }
				: null,
			false,
			one ? { label: menuLabel('cabinet.properties'), run: openProps } : null,
			writable ? { label: menuLabel('cabinet.delete', hotkeys.delete), danger: true, run: deleteSelection } : null,
		]
		: [
			writable ? { label: menuLabel('cabinet.upload'), run: () => document.getElementById('fileInput').click() } : null,
			writable ? { label: menuLabel('cabinet.uploadFolder'), run: () => document.getElementById('folderInput').click() } : null,
			writable ? { label: menuLabel('cabinet.newFolder'), run: createFolder } : null,
			{ label: menuLabel('cabinet.newWindow', hotkeys.newWindow), run: openCurrentInNewWindow },
			false,
			writable && hasClip ? { label: menuLabel('cabinet.paste', hotkeys.paste), run: () => pasteClipboard() } : null,
			writable && hasClip ? { label: menuLabel('cabinet.pasteLink', hotkeys.pasteLink), run: () => pasteClipboard(true) } : null,
			false,
			!remoteEntityHash && history.canUndo()
				? { label: menuLabel('cabinet.undo', hotkeys.undo), run: () => history.undo().then(() => refreshEntries()) }
				: null,
			!remoteEntityHash && history.canRedo()
				? { label: menuLabel('cabinet.redo', hotkeys.redo), run: () => history.redo().then(() => refreshEntries()) }
				: null,
			false,
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
	const items = []
	for (const action of actions) {
		if (action === null) continue
		if (action === false) {
			if (items.length && items[items.length - 1] !== false) items.push(false)
			continue
		}
		items.push(action)
	}
	while (items[0] === false) items.shift()
	while (items.at(-1) === false) items.pop()
	for (const action of items) {
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
