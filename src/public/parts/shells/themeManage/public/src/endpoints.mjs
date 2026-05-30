/**
 * 主题管理 shell 的客户端 API。
 */

/**
 * 解析 JSON 响应，失败时抛出错误。
 * @param {Response} response - fetch 响应。
 * @returns {Promise<object>} 解析后的 JSON。
 */
async function parseJsonResponse(response) {
	if (!response.ok) {
		const data = await response.json().catch(() => ({}))
		throw new Error(data.error || data.message || `HTTP error! status: ${response.status}`)
	}
	return response.json()
}

/**
 * 获取自定义主题列表。
 * @returns {Promise<object[]>} 主题列表。
 */
export async function listCustomThemes() {
	const response = await fetch('/api/parts/shells:themeManage/list')
	return parseJsonResponse(response)
}

/**
 * 获取单个自定义主题。
 * @param {string} id - 主题 ID。
 * @returns {Promise<object>} 主题数据。
 */
export async function getCustomTheme(id) {
	const response = await fetch(`/api/parts/shells:themeManage/theme/${encodeURIComponent(id)}`)
	return parseJsonResponse(response)
}

/**
 * 保存自定义主题。
 * @param {object} data - 主题数据。
 * @returns {Promise<object>} 保存结果（含 id）。
 */
export async function saveCustomTheme(data) {
	const response = await fetch('/api/parts/shells:themeManage/save', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	return parseJsonResponse(response)
}

/**
 * 删除自定义主题。
 * @param {string} id - 主题 ID。
 * @returns {Promise<void>}
 */
export async function deleteCustomTheme(id) {
	const response = await fetch(`/api/parts/shells:themeManage/theme/${encodeURIComponent(id)}`, { method: 'DELETE' })
	await parseJsonResponse(response)
}
