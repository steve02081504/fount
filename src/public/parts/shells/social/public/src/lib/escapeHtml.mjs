/**
 * 将文本转为可安全插入 HTML 的字符串。
 * @param {string|null|undefined} text 原始文本
 * @returns {string} 转义后的 HTML 片段
 */
export function escapeHtml(text) {
	const div = document.createElement('div')
	div.textContent = text == null ? '' : String(text)
	return div.innerHTML
}
