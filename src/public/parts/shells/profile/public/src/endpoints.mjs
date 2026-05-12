/**
 * 个人资料 API 端点
 */

/**
 * 获取用户资料
 * @param {string} username - 用户名
 * @returns {Promise<object>}
 */
export async function getProfile(username) {
	const response = await fetch(`/api/parts/shells:profile/${username}`, {
		credentials: 'include'
	})
	return await response.json()
}

/**
 * 更新用户资料
 * @param {string} username - 用户名
 * @param {object} updates - 更新内容
 * @returns {Promise<object>}
 */
export async function updateProfile(username, updates) {
	const response = await fetch(`/api/parts/shells:profile/${username}`, {
		method: 'PUT',
		headers: {
			'Content-Type': 'application/json'
		},
		credentials: 'include',
		body: JSON.stringify(updates)
	})
	return await response.json()
}

/**
 * 上传头像
 * @param {string} username - 用户名
 * @param {File} file - 头像文件
 * @returns {Promise<object>}
 */
export async function uploadAvatar(username, file) {
	const formData = new FormData()
	formData.append('avatar', file)

	const response = await fetch(`/api/parts/shells:profile/${username}/avatar`, {
		method: 'POST',
		credentials: 'include',
		body: formData
	})
	return await response.json()
}

/**
 * 获取用户统计
 * @param {string} username - 用户名
 * @returns {Promise<object>}
 */
export async function getStats(username) {
	const response = await fetch(`/api/parts/shells:profile/${username}/stats`, {
		credentials: 'include'
	})
	return await response.json()
}

/**
 * 更新用户状态
 * @param {string} username - 用户名
 * @param {string} status - 状态
 * @param {string} customStatus - 自定义状态
 * @returns {Promise<object>}
 */
export async function updateStatus(username, status, customStatus = '') {
	const response = await fetch(`/api/parts/shells:profile/${username}/status`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		credentials: 'include',
		body: JSON.stringify({ status, customStatus })
	})
	return await response.json()
}
