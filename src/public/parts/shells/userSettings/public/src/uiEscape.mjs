/**
 * 转义 HTML 属性值中的特殊字符。
 * @param {string} [s] - 原始字符串。
 * @returns {string} - 转义后的字符串。
 */
export function escapeAttr(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/'/g, '&#39;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
}

/**
 * 转义可放入 innerHTML 相邻文本的片段（不含引号场景）。
 * @param {string} [s] - 原始字符串。
 * @returns {string} - 转义后的字符串。
 */
export function escapeHtmlText(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
}
