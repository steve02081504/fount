/**
 * 快捷键命令分发（对接 keyboard.mjs 纯匹配）。
 */
import { hideContextMenu } from './contextMenu.mjs'
import {
	copySelection,
	deleteSelection,
	onEntryOpen,
	pasteClipboard,
	renameSelection,
} from './entryActions.mjs'
import { selectAllEntries, selectedEntries } from './entryGrid.mjs'
import { goUp, openCurrentInNewWindow } from './navigation.mjs'
import { canWrite, cabinetStore, hasClipboard } from './state.mjs'

/**
 * @param {string} command 命令
 * @returns {Promise<boolean>} 是否处理
 */
export async function runCommand(command) {
	const { selected, history, entries, currentParentId } = cabinetStore
	switch (command) {
		case 'copy':
			copySelection('copy')
			return true
		case 'cut':
			if (!canWrite() || !selected.size) return false
			copySelection('cut')
			return true
		case 'paste':
			if (!canWrite() || !hasClipboard()) return false
			await pasteClipboard(false)
			return true
		case 'pasteLink':
			if (!canWrite() || !hasClipboard()) return false
			await pasteClipboard(true)
			return true
		case 'selectAll':
			if (!entries.length) return false
			selectAllEntries()
			return true
		case 'delete':
			if (!canWrite() || !selected.size) return false
			await deleteSelection()
			return true
		case 'undo':
			if (!history.canUndo()) return false
			await history.undo()
			return true
		case 'redo':
			if (!history.canRedo()) return false
			await history.redo()
			return true
		case 'newWindow':
			openCurrentInNewWindow()
			return true
		case 'rename':
			if (!canWrite() || selected.size !== 1) return false
			await renameSelection()
			return true
		case 'goUp':
			if (!currentParentId) return false
			await goUp()
			return true
		case 'open': {
			const [entry] = selectedEntries()
			if (!entry) return false
			await onEntryOpen(entry)
			return true
		}
		case 'escape':
			hideContextMenu()
			return true
		default:
			return false
	}
}
