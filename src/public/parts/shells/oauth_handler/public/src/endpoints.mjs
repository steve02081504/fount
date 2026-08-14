/**
 * oauth_handler 前端 API。
 */

/**
 * 调用 oauth_handler REST。
 * @param {string} path - 路径（不含前缀）。
 * @param {string} [method='GET'] - HTTP 方法。
 * @param {object} [body] - JSON body。
 * @returns {Promise<any>} JSON。
 */
async function callApi(path, method = 'GET', body) {
	const response = await fetch(`/api/parts/shells:oauth_handler/${path}`, {
		method,
		headers: { 'Content-Type': 'application/json' },
		body: body ? JSON.stringify(body) : undefined,
	})
	const data = await response.json().catch(() => ({}))
	if (!response.ok) throw Object.assign(new Error(data.message || response.statusText), data)
	return data
}

/**
 * 开始 OAuth 登录。
 * @param {object} body - start 参数。
 * @returns {Promise<object>} start 结果。
 */
export function startOAuth(body) {
	return callApi('start', 'POST', body)
}

/**
 * 用授权码完成 PKCE。
 * @param {{ state: string, code: string }} body - complete 参数。
 * @returns {Promise<object>} 凭证。
 */
export function completeOAuth(body) {
	return callApi('complete', 'POST', body)
}

/**
 * 查询登录状态。
 * @param {string} state - OAuth state。
 * @returns {Promise<object>} 状态。
 */
export function oauthStatus(state) {
	return callApi(`status/${encodeURIComponent(state)}`)
}

/**
 * 取消登录。
 * @param {string} state - OAuth state。
 * @returns {Promise<object>} 空对象。
 */
export function cancelOAuth(state) {
	return callApi('cancel', 'POST', { state })
}
