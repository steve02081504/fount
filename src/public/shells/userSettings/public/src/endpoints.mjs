// Helper function to make API calls
async function callApi(endpoint, method = 'POST', body) {
	const response = await fetch(`/api/shells/userSettings/${endpoint}`, {
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
	return callApi('stats', 'GET')
}

export async function changePassword(currentPassword, newPassword) {
	return callApi('change_password', 'POST', { currentPassword, newPassword })
}

export async function getDevices() {
	return callApi('devices', 'GET')
}

export async function revokeDevice(tokenJti, password) {
	return callApi('revoke_device', 'POST', { tokenJti, password })
}

export async function renameUser(newUsername, password) {
	return callApi('rename_user', 'POST', { newUsername, password })
}

export async function deleteAccount(password) {
	return callApi('delete_account', 'POST', { password })
}
