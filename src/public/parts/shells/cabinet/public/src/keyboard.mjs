/**
 * 文件柜快捷键匹配（纯函数，可单测）。
 */

/**
 * @param {EventTarget | null} target 事件目标
 * @returns {boolean} 是否处于可编辑控件
 */
export function isEditableTarget(target) {
	if (!target || typeof target !== 'object') return false
	const el = /** @type {{ tagName?: string, isContentEditable?: boolean, closest?: (s: string) => unknown }} */ target
	if (typeof el.closest === 'function' && el.closest('dialog[open]')) return true
	const tag = el.tagName
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
	if (el.isContentEditable) return true
	if (typeof el.closest === 'function' && el.closest('[contenteditable="true"]')) return true
	return false
}

/**
 * @param {KeyboardEvent} event 键盘事件
 * @returns {string | null} 命令 id
 */
export function matchCabinetShortcut(event) {
	if (isEditableTarget(event.target)) return null
	const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
	const mod = event.ctrlKey || event.metaKey

	if (mod && key === 'c' && !event.shiftKey && !event.altKey) return 'copy'
	if (mod && key === 'x' && !event.shiftKey && !event.altKey) return 'cut'
	if (mod && key === 'v' && event.shiftKey && !event.altKey) return 'pasteLink'
	if (mod && key === 'v' && !event.shiftKey && !event.altKey) return 'paste'
	if (mod && key === 'a' && !event.shiftKey && !event.altKey) return 'selectAll'
	if (mod && key === 'd' && !event.shiftKey && !event.altKey) return 'delete'
	if (mod && key === 'z' && event.shiftKey && !event.altKey) return 'redo'
	if (mod && key === 'z' && !event.shiftKey && !event.altKey) return 'undo'
	if (mod && key === 'y' && !event.shiftKey && !event.altKey) return 'redo'
	if (mod && key === 'n' && !event.shiftKey && !event.altKey) return 'newWindow'
	if (!mod && !event.altKey && !event.shiftKey && key === 'F2') return 'rename'
	if (!mod && !event.altKey && !event.shiftKey && key === 'Delete') return 'goUp'
	if (!mod && !event.altKey && !event.shiftKey && key === 'Enter') return 'open'
	if (!mod && !event.altKey && !event.shiftKey && key === 'Escape') return 'escape'
	return null
}

/**
 * 快捷键展示文案（菜单旁注）。
 * @param {boolean} [mac] 是否 mac
 * @returns {Record<string, string>} 命令 → 文案
 */
export function shortcutLabels(mac = false) {
	const m = mac ? '⌘' : 'Ctrl+'
	return {
		copy: `${m}C`,
		cut: `${m}X`,
		paste: `${m}V`,
		pasteLink: `${m}Shift+V`,
		selectAll: `${m}A`,
		delete: `${m}D`,
		undo: `${m}Z`,
		redo: mac ? '⌘⇧Z' : 'Ctrl+Y',
		newWindow: `${m}N`,
		rename: 'F2',
		goUp: 'Del',
	}
}
