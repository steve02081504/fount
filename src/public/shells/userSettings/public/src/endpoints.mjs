// Helper function to make API calls
async function callApi(endpoint, method = 'POST', body) {
	const response = await fetch(`/api/${endpoint}`, {
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

export async function getUserStats() {
	return callApi('shells/userSettings/stats', 'GET')
}

export async function changePassword(currentPassword, newPassword) {
	return callApi('shells/userSettings/change_password', 'POST', { currentPassword, newPassword })
}

export async function getDevices() {
	return callApi('shells/userSettings/devices', 'GET')
}

export async function revokeDevice(tokenJti, password) {
	return callApi('shells/userSettings/revoke_device', 'POST', { tokenJti, password })
}

export async function renameUser(newUsername, password) {
	return callApi('shells/userSettings/rename_user', 'POST', { newUsername, password })
}

export async function deleteAccount(password) {
	return callApi('shells/userSettings/delete_account', 'POST', { password })
}

export async function logoutUser() {
	return callApi('logout', 'POST')
}

export async function getApiKeys() {
	return callApi('apikey/list', 'GET')
}

export async function createApiKey(description) {
	return callApi('apikey/create', 'POST', { description })
}

export async function revokeApiKey(jti) {
	return callApi('apikey/revoke', 'POST', { jti })
}
