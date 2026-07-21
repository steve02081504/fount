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
	if (event.altKey) return null
	if (mod) {
		if (key === 'c' && !event.shiftKey) return 'copy'
		if (key === 'x' && !event.shiftKey) return 'cut'
		if (key === 'v') return event.shiftKey ? 'pasteLink' : 'paste'
		if (key === 'a' && !event.shiftKey) return 'selectAll'
		if (key === 'd' && !event.shiftKey) return 'delete'
		if (key === 'z') return event.shiftKey ? 'redo' : 'undo'
		if (key === 'y' && !event.shiftKey) return 'redo'
		if (key === 'n' && !event.shiftKey) return 'newWindow'
		return null
	}
	if (event.shiftKey) return null
	if (key === 'F2') return 'rename'
	if (key === 'Delete') return 'goUp'
	if (key === 'Enter') return 'open'
	if (key === 'Escape') return 'escape'
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
