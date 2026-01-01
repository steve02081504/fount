/**
 * 用户设置 shell 的客户端 API 端点。
 */

/**
 * 调用 API。
 * @param {string} endpoint - 端点。
 * @param {'GET' | 'POST'} [method='POST'] - 方法。
 * @param {any} [body] - 正文。
 * @returns {Promise<any>} - 响应数据。
 */
async function callApi(endpoint, method = 'POST', body) {
	const response = await fetch(`/api/parts/shells:userSettings/${endpoint}`, {
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
 * 获取用户统计信息。
 * @returns {Promise<any>} - 用户统计信息。
 */
export async function getUserStats() {
	return callApi('stats', 'GET')
}

/**
 * 更改密码。
 * @param {string} currentPassword - 当前密码。
 * @param {string} newPassword - 新密码。
 * @returns {Promise<any>} - 响应数据。
 */
export async function changePassword(currentPassword, newPassword) {
	return callApi('change_password', 'POST', { currentPassword, newPassword })
}

/**
 * 获取设备。
 * @returns {Promise<any>} - 设备。
 */
export async function getDevices() {
	return callApi('devices', 'GET')
}

/**
 * 撤销设备。
 * @param {string} tokenJti - 令牌 JTI。
 * @param {string} password - 密码。
 * @returns {Promise<any>} - 响应数据。
 */
export async function revokeDevice(tokenJti, password) {
	return callApi('revoke_device', 'POST', { tokenJti, password })
}

/**
 * 重命名用户。
 * @param {string} newUsername - 新用户名。
 * @param {string} password - 密码。
 * @returns {Promise<any>} - 响应数据。
 */
export async function renameUser(newUsername, password) {
	return callApi('rename_user', 'POST', { newUsername, password })
}

/**
 * 删除帐户。
 * @param {string} password - 密码。
 * @returns {Promise<any>} - 响应数据。
 */
export async function deleteAccount(password) {
	return callApi('delete_account', 'POST', { password })
}
