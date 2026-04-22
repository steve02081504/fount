import { throwUserSettingsApiError } from '/scripts/userSettingsApiError.mjs'

/**
 * UserSettings shell：`callApi` 仅 fetch；JSON 且 `success: false`、或非 JSON 的错误响应会抛 `throwUserSettingsApiError`。
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
	if (contentType?.includes('application/json')) {
		const data = await response.json()
		if (data.success === false)
			throwUserSettingsApiError(data.i18nKey, data.i18nParams)
		return data
	}
	const text = await response.text()
	if (!response.ok)
		throwUserSettingsApiError('userSettings.shell.responseNotJson')

	return { success: true, data: text }
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

/**
 * 列出已注册的安全密钥。
 * @returns {Promise<any>} - 响应数据。
 */
export async function getWebAuthnCredentials() {
	return callApi('webauthn_credentials', 'GET')
}

/**
 * 开始注册安全密钥。
 * @param {string} password - 当前账户密码（重新认证）。
 * @returns {Promise<any>} - 响应数据。
 */
export async function webauthnRegisterBegin(password) {
	return callApi('webauthn_register_begin', 'POST', { password })
}

/**
 * 完成注册安全密钥。
 * @param {object} credential - 浏览器凭证。
 * @param {string} [nickname] - 显示名称。
 * @param {string} password - 当前账户密码（重新认证）。
 * @returns {Promise<any>} - 响应数据。
 */
export async function webauthnRegisterComplete(credential, nickname, password) {
	return callApi('webauthn_register_complete', 'POST', { credential, nickname, password })
}

/**
 * 移除安全密钥。
 * @param {string} credentialId - 凭证 ID。
 * @param {string} password - 当前密码。
 * @returns {Promise<any>} - 响应数据。
 */
export async function webauthnRemove(credentialId, password) {
	return callApi('webauthn_remove', 'POST', { credentialId, password })
}
