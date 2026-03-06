const BASE = '/api/parts/shells:subfounts'

/**
 * 向 subfounts API 发起请求的通用函数。
 * @param {string} endpoint - 相对于 BASE 的端点路径。
 * @param {'GET'|'POST'|'PUT'|'DELETE'} [method='GET'] - HTTP 方法。
 * @param {object} [body] - 请求体数据。
 * @returns {Promise<any>} 解析后的 JSON 响应数据。
 */
async function callApi(endpoint, method = 'GET', body) {
	const res = await fetch(`${BASE}/${endpoint}`, {
		method,
		headers: body ? { 'Content-Type': 'application/json' } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	})
	if (!res.ok) {
		const errData = await res.json().catch(() => ({}))
		throw new Error(errData.error || `HTTP ${res.status}`)
	}
	return res.json()
}

/**
 * 获取当前用户的连接代码和密码。
 * @returns {Promise<{peerId: string, password: string}>} 连接代码对象。
 */
export function getConnectionCode() {
	return callApi('connection-code')
}

/**
 * 重新生成连接代码和密码。
 * @returns {Promise<{peerId: string, password: string}>} 新的连接代码对象。
 */
export function regenerateCode() {
	return callApi('regenerate-code', 'POST')
}

/**
 * 设置指定设备的描述备注。
 * @param {number} deviceId - 设备 ID。
 * @param {string|null} description - 描述文本，传入空字符串会被转为 null。
 * @returns {Promise<{success: boolean}>} 操作结果。
 */
export function setDescription(deviceId, description) {
	return callApi('set-description', 'POST', { deviceId, description: description || null })
}

/**
 * 在指定分机上执行代码。
 * @param {number} subfountId - 目标分机 ID（0 为本机）。
 * @param {string} script - 要执行的脚本内容。
 * @returns {Promise<{success: boolean, result: any}>} 执行结果。
 */
export function executeCode(subfountId, script) {
	return callApi('execute', 'POST', { subfountId, script })
}
