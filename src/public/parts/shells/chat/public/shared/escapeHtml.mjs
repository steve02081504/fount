/**
 * Deno/浏览器共用的 HTML 转义（无 `/scripts` URL 依赖）。
 * @param {string} text 原文
 * @returns {string} 可安全插入属性/文本节点的片段
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
