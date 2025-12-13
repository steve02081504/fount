/**
 * 成就 shell 的客户端 API 调用。
 */

/**
 * 对成就 shell 的后端 API 进行调用的通用函数。
 * @param {string} endpoint - 要调用的 API 端点（例如 'sources'）。
 * @param {string} [method='GET'] - HTTP 方法。
 * @param {object} [body] - 请求的主体。
 * @returns {Promise<any>} - 从 API 返回的 JSON 响应。
 */
async function callApi(endpoint, method = 'GET', body) {
	const response = await fetch(`/api/shells/achievements/${endpoint}`, {
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
 * 从服务器获取所有成就源和它们的状态。
 * @returns {Promise<any>} - 包含所有成就数据的 API 响应。
 */
export function getAllAchievements() {
	return callApi('sources', 'GET')
}

/**
 * 为指定用户锁定一个成就。
 * @param {string} parttype - 成就所属部件的类型。
 * @param {string} partname - 成就所属部件的名称。
 * @param {string} id - 要锁定的成就的ID。
 * @param {string} reason - 锁定成就的原因。
 * @returns {Promise<any>} - 从 API 返回的 JSON 响应。
 */
export function lockAchievement(parttype, partname, id, reason) {
	return callApi(`lock/${parttype}/${partname}/${id}`, 'POST', { reason })
}
