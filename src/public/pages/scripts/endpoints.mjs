import { throwUserSettingsApiError } from '../../scripts/userSettingsApiError.mjs'

/**
 * 解析 JSON：`response.ok` 为 false 则 reject；`data.success === false` 则 `throwUserSettingsApiError`。
 * @param {Response} response - fetch 响应。
 * @returns {Promise<object>} 解析后的 JSON 对象。
 */
async function finishAuthenticatedJsonMutation(response) {
	const data = await response.json().catch(() => ({}))
	if (!response.ok)
		return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), data, { response }))
	if (data.success === false)
		throwUserSettingsApiError(data.i18nKey, data.i18nParams)
	return data
}

/**
 * Ping 服务器。
 * @param {boolean} [with_cache=false] - 是否使用缓存。
 * @returns {Promise<object>} - 服务器响应。
 */
export async function ping(with_cache = false) {
	const response = await fetch('/api/ping', {
		credentials: 'omit',
		cache: with_cache ? 'default' : 'no-cache',
	})
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => ({})), { response }))
	return response.json()
}

/**
 * 获取本地 IP 中的主机 URL。
 * @returns {Promise<string>} - 本地 IP 中的主机 URL。
 */
export async function hosturl_in_local_ip() {
	return ping(true).then(data => data.hosturl_in_local_ip).catch(() => window.location.origin)
}

/**
 * 获取 PoW 挑战。
 * @returns {Promise<object>} - PoW 挑战。
 */
export async function getPoWChallenge() {
	const response = await fetch('/api/pow/challenge', { method: 'POST' })
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => ({})), { response }))
	return response.json()
}

/**
 * 兑换 PoW 令牌。
 * @param {string} token - PoW 令牌。
 * @param {object[]} solutions - PoW 解决方案。
 * @returns {Promise<object>} - 兑换结果。
 */
export async function redeemPoWToken(token, solutions) {
	const response = await fetch('/api/pow/redeem', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ token, solutions }),
	})
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => ({})), { response }))
	return response.json()
}

/**
 * 获取区域设置数据。
 * @param {string[]} [preferred] - 首选语言列表。
 * @returns {Promise<object>} - 区域设置数据。
 */
export async function getLocaleData(preferred) {
	const url = new URL(window.location.origin + '/api/getlocaledata')
	if (preferred) url.searchParams.set('preferred', preferred.join(','))
	const response = await fetch(url)
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => ({})), { response }))
	return response.json()
}

/**
 * 获取可用的区域设置。
 * @returns {Promise<string[]>} - 可用区域设置的列表。
 */
export async function getAvailableLocales() {
	const response = await fetch('/api/getavailablelocales')
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => ({})), { response }))
	return response.json()
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
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => ({})), { response }))
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
 * Passkey 登录：请求挑战选项。
 * @param {string} [powToken] - POW 令牌。
 * @returns {Promise<Response>} - 服务器响应。
 */
export async function webauthnLoginBegin(powToken) {
	return await fetch('/api/webauthn/login/begin', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ powToken }),
	})
}

/**
 * Passkey 登录：提交断言并完成会话。
 * @param {object} credential - 浏览器返回的凭证 JSON。
 * @param {string} authSessionToken - begin 返回的会话令牌。
 * @param {string} deviceid - 设备 ID。
 * @param {string} [powToken] - POW 令牌。
 * @returns {Promise<Response>} - 服务器响应。
 */
export async function webauthnLoginComplete(credential, authSessionToken, deviceid, powToken) {
	return await fetch('/api/webauthn/login/complete', {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			credential,
			deviceid,
			powToken,
			authSessionToken: (authSessionToken ?? '').trim(),
		}),
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
		method: 'POST',
	})
}


/**
 * 获取用户设置。
 * @param {string} key - 键。
 * @returns {Promise<any>} - 用户设置值。
 */
export async function getUserSetting(key) {
	const response = await fetch(`/api/getusersetting?key=${encodeURIComponent(key)}`)
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => ({})), { response }))
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
	return finishAuthenticatedJsonMutation(response)
}

/**
 * 获取 API 密钥。
 * @returns {Promise<object>} - API 密钥列表。
 */
export async function getApiKeys() {
	const response = await fetch('/api/apikey/list')
	return finishAuthenticatedJsonMutation(response)
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
	return finishAuthenticatedJsonMutation(response)
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
	return finishAuthenticatedJsonMutation(response)
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
 * 获取 API cookie。
 * @param {string} apiKey - 要使用的 API 密钥。
 * @returns {Promise<object>} - 服务器响应。
 */
export async function getApiCookie(apiKey) {
	const response = await fetch('/api/get-api-cookie', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ apiKey }),
	})
	if (!response.ok) return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => ({})), { response }))
	return response.json()
}
