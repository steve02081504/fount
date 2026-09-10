/**
 * code shell 图标：Iconify CDN URL 与图标元素（交由 svgInliner 内联后随主题着色）。
 */
const ICONIFY_CDN = 'https://api.iconify.design'

/**
 * 构建 Iconify CDN SVG URL。
 * @param {string} icon - 图标集 / 图标 id（如 `mdi/close`）。
 * @returns {string} 绝对 URL。
 */
export function iconifyUrl(icon) {
	return `${ICONIFY_CDN}/${icon}.svg`
}

/**
 * 创建 Iconify 图标元素。
 * @param {string} icon - 图标集 / 图标 id。
 * @param {{ size?: number, className?: string, id?: string }} [options] - 元素选项。
 * @returns {HTMLImageElement} 图标 img（待 svgInliner 内联）。
 */
export function iconElement(icon, { size = 16, className = 'text-icon', id = '' } = {}) {
	const image = document.createElement('img')
	image.src = iconifyUrl(icon)
	image.className = className
	image.width = size
	image.height = size
	image.alt = ''
	image.setAttribute('aria-hidden', 'true')
	if (id) image.id = id
	return image
}

/** code shell 图标 id。 */
export const icons = {
	home: 'mdi/view-dashboard-outline',
	attach: 'mdi/paperclip',
	send: 'mdi/arrow-up',
	stop: 'mdi/stop',
	chevronDown: 'mdi/chevron-down',
	copy: 'mdi/content-copy',
	edit: 'mdi/pencil-outline',
	download: 'mdi/download-outline',
	thumbUp: 'mdi/thumb-up-outline',
	thumbDown: 'mdi/thumb-down-outline',
	regen: 'mdi/refresh',
	plus: 'mdi/plus',
	close: 'mdi/close',
	trash: 'mdi/trash-can-outline',
}
