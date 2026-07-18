/**
 * HTML / attribute 转义。
 */

/**
 * @param {string} text 文本
 * @returns {string} 转义
 */
export function escapeHtml(text) {
	return String(text).replace(/[&<>"']/g, ch => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;',
	})[ch])
}

/**
 * @param {string} text 文本
 * @returns {string} 属性转义
 */
export function escapeAttr(text) {
	return escapeHtml(text)
}
