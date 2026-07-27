/**
 * 右键/上下文菜单定位：固定到指针或锚点，并钳入视口。
 * @param {HTMLElement} menu 菜单根节点
 * @param {{ x: number, y: number, minWidth?: number | string, maxWidth?: number | string }} options 坐标与宽度
 * @returns {void}
 */
export function positionContextMenu(menu, { x, y, minWidth = '10rem', maxWidth } = {}) {
	menu.style.position = 'fixed'
	menu.style.left = `${x}px`
	menu.style.top = `${y}px`
	if (minWidth != null) menu.style.minWidth = typeof minWidth === 'number' ? `${minWidth}px` : minWidth
	if (maxWidth != null) menu.style.maxWidth = typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth
	const rect = menu.getBoundingClientRect()
	const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))
	const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))
	menu.style.left = `${left}px`
	menu.style.top = `${top}px`
}
