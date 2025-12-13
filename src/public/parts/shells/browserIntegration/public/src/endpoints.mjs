/**
 * 浏览器集成 shell 的客户端 API 调用。
 */

/**
 * 对浏览器集成 shell 的后端 API 进行调用的通用函数。
 * @param {string} endpoint - 要调用的 API 端点。
 * @param {string} [method='POST'] - HTTP 方法。
 * @param {object} [body] - 请求的主体。
 * @returns {Promise<any>} - 从 API 返回的 JSON 响应。
 */
async function callApi(endpoint, method = 'POST', body) {
	const response = await fetch(`/api/shells/browserIntegration/${endpoint}`, {
		method,
		headers: { 'Content-Type': 'application/json' },
		body: body ? JSON.stringify(body) : undefined,
	})
	const contentType = response.headers.get('content-type')
	if (contentType && contentType.indexOf('application/json') !== -1)
		return response.json()
	else {
		const text = await response.text()
		if (!response.ok)
			return { success: false, message: text || response.statusText }

		return { success: true, data: text }
	}
}

/**
 * 获取所有自动运行脚本。
 * @returns {Promise<any>} - API 响应。
 */
export function getAutoRunScripts() {
	return callApi('autorun-scripts', 'GET')
}

/**
 * 添加一个新的自动运行脚本。
 * @param {object} scriptData - 要添加的脚本的数据。
 * @returns {Promise<any>} - API 响应。
 */
export function addAutoRunScript(scriptData) {
	return callApi('autorun-scripts', 'POST', scriptData)
}

/**
 * 删除一个自动运行脚本。
 * @param {string} id - 要删除的脚本的 ID。
 * @returns {Promise<any>} - API 响应。
 */
export function deleteAutoRunScript(id) {
	return callApi(`autorun-scripts/${id}`, 'DELETE')
}
