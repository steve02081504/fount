/** 工具调用摘要：只展示操作对象，不把文件替换正文塞进折叠标题。 */

/**
 * 压缩空白并限制摘要长度，完整内容仍在展开视图中。
 * @param {unknown} value 原始文本。
 * @returns {string} 单行摘要。
 */
export function compactToolSummary(value) {
	const text = String(value ?? '').replace(/\s+/g, ' ').trim()
	return text.length > 240 ? text.slice(0, 239) + '…' : text
}

/**
 * 从解析后的调用提取路径、查询或执行代码。
 * @param {object} call 工具调用。
 * @returns {string} 摘要。
 */
export function summarizeToolCall(call) {
	const params = call.params || {}
	const body = call.inner ?? call.body ?? ''
	if (call.tag === 'glob' || call.tag === 'grep')
		return compactToolSummary(`${body || params.pattern || ''} · ${params.path || '.'}`)
	const paths = call.tag === 'replace-file'
		? [...String(body).matchAll(/<file\s+path="([^"]+)"/g)].map(match => match[1]) : []
	const target = paths.length ? [...new Set(paths)].join(', ')
		: params.path || params.pattern || params.query || params.id
			|| (/^(?:run-|inline-|view-file|glob|grep)/.test(call.tag || '') ? body : '')
	return compactToolSummary(target)
}
