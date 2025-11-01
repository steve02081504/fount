/**
 * Ping 服务器。
 * @param {boolean} [with_cache=false] - 是否使用缓存。
 * @returns {Promise<object>} - 服务器响应。
 */
export async function ping(with_cache = false) {
	const response = await fetch('/api/ping', { cache: with_cache ? 'default' : 'no-cache' })
	return response.json()
}

/**
 * 获取本地 IP 中的主机 URL。
 * @returns {Promise<string>} - 本地 IP 中的主机 URL。
 */
export async function hosturl_in_local_ip() {
	return ping(1).then(data => data.hosturl_in_local_ip).catch(() => window.location.origin)
}

/**
 * 生成验证码。
 * @returns {Promise<Response>} - 服务器响应。
 */
export async function generateVerificationCode() {
	return await fetch('/api/register/generateverificationcode', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
	})
}

/**
 * 获取当前用户信息。
 * @returns {Promise<object>} - 当前用户信息。
 */
export async function whoami() {
	const response = await fetch('/api/whoami', {
		headers: { Accept: 'application/json' },
	})
	return response.json()
}

/**
 * 登录。
 * @param {string} username - 用户名。
 * @param {string} password - 密码。
 * @param {string} deviceid - 设备 ID。
 * @param {string} powToken - POW 令牌。
 * @returns {Promise<Response>} - 服务器响应。
 */
export async function login(username, password, deviceid, powToken) {
	return await fetch('/api/login', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ username, password, deviceid, powToken }),
	})
}

/**
 * 注册。
 * @param {string} username - 用户名。
 * @param {string} password - 密码。
 * @param {string} deviceid - 设备 ID。
 * @param {string} verificationcode - 验证码。
 * @param {string} powToken - POW 令牌。
 * @returns {Promise<Response>} - 服务器响应。
 */
export async function register(username, password, deviceid, verificationcode, powToken) {
	return await fetch('/api/register', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ username, password, deviceid, verificationcode, powToken }),
	})
}

/**
 * 验证身份。
 * @returns {Promise<Response>} - 服务器响应。
 */
export async function authenticate() {
	return await fetch('/api/authenticate', {
		method: 'POST'
	})
}

/**
 * 运行部件。
 * @param {string} parttype - 部件类型。
 * @param {string} partname - 部件名称。
 * @param {object} args - 参数。
 * @returns {Promise<Response>} - 服务器响应。
 */
export async function runPart(parttype, partname, args) {
	return await fetch('/api/runpart', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ parttype, partname, args }),
	})
}

/**
 * 加载部件。
 * @param {string} parttype - 部件类型。
 * @param {string} partname - 部件名称。
 * @returns {Promise<Response>} - 服务器响应。
 */
export async function loadPart(parttype, partname) {
	return await fetch('/api/loadpart', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ parttype, partname }),
	})
}

/**
 * 获取用户设置。
 * @param {string} key - 键。
 * @returns {Promise<any>} - 用户设置值。
 */
export async function getUserSetting(key) {
	const response = await fetch(`/api/getusersetting?key=${encodeURIComponent(key)}`)
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	const { value } = await response.json()
	return value
}

/**
 * 设置用户设置。
 * @param {string} key - 键。
 * @param {any} value - 值。
 * @returns {Promise<Response>} - 服务器响应。
 */
export async function setUserSetting(key, value) {
	return await fetch('/api/setusersetting', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ key, value }),
	})
}

/**
 * 注销。
 * @returns {Promise<object>} - 服务器响应。
 */
export async function logout() {
	const response = await fetch('/api/logout', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
	})
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	return response.json()
}

/**
 * 获取 API 密钥。
 * @returns {Promise<object>} - API 密钥列表。
 */
export async function getApiKeys() {
	const response = await fetch('/api/apikey/list')
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	return response.json()
}

/**
 * 创建 API 密钥。
 * @param {string} description - 描述。
 * @returns {Promise<object>} - 新的 API 密钥。
 */
export async function createApiKey(description) {
	const response = await fetch('/api/apikey/create', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ description }),
	})
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	return response.json()
}

/**
 * 撤销 API 密钥。
 * @param {string} jti - JTI。
 * @param {string} password - 密码。
 * @returns {Promise<object>} - 服务器响应。
 */
export async function revokeApiKey(jti, password) {
	const response = await fetch('/api/apikey/revoke', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ jti, password }),
	})
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	return response.json()
}

/**
 * 验证 API 密钥。
 * @param {string} apiKey - API 密钥。
 * @returns {Promise<Response>} - 服务器响应。
 */
export async function verifyApiKey(apiKey) {
	return await fetch('/api/apikey/verify', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ apiKey }),
	})
}

/**
 * 解锁成就。
 * @param {string} parttype - 部件类型。
 * @param {string} partname - 部件名称。
 * @param {string} achievementId - 成就 ID。
 * @returns {Promise<Response>} - 服务器响应。
 */
export function unlockAchievement(parttype, partname, achievementId) {
	return fetch(`/api/shells/achievements/unlock/${parttype}/${partname}/${achievementId}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
	}).catch(() => { /* Fail silently */ })
}
