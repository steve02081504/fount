/**
 * 将文本转为可安全插入 HTML 文本节点或属性值的字符串。
 * 必须转义引号：`textContent`/`innerHTML` 往返不会转义 `"`，不能用于属性。
 * @param {string} text 原始文本
 * @returns {string} 转义后的 HTML 片段
 */
export function escapeHtml(text) {
	return String(text ?? '').replace(/[&<>"']/g, char => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		'\'': '&#39;',
	}[char]))
}
