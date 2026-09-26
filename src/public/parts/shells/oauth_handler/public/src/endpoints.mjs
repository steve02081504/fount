/**
 * oauth_handler 前端 API。
 */

/**
 * 解析 oauth_handler JSON 响应。
 * @param {Response} response - fetch 响应。
 * @returns {Promise<any>} JSON。
 */
async function readJson(response) {
	const data = await response.json()
	if (!response.ok) throw Object.assign(new Error(data.message || response.statusText), data)
	return data
}

/**
 * 开始 OAuth 登录。
 * @param {object} body - start 参数。
 * @returns {Promise<object>} start 结果。
 */
export async function startOAuth(body) {
	return readJson(await fetch('/api/parts/shells:oauth_handler/start', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	}))
}

/**
 * 用授权码完成 PKCE。
 * @param {{ state: string, code: string }} body - complete 参数。
 * @returns {Promise<object>} 完成状态。
 */
export async function completeOAuth(body) {
	return readJson(await fetch('/api/parts/shells:oauth_handler/complete', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	}))
}

/**
 * 查询登录状态。
 * @param {string} state - OAuth state。
 * @returns {Promise<object>} 状态。
 */
export async function oauthStatus(state) {
	return readJson(await fetch(`/api/parts/shells:oauth_handler/status/${encodeURIComponent(state)}`))
}

/**
 * 列出当前账号的 Codex 模型及其推理强度；此接口不回传 OAuth 凭证。
 * @param {string} sourceName - Codex 服务源名。
 * @returns {Promise<{ models: Array<object> }>} 可选模型。
 */
export async function codexModels(sourceName) {
	return readJson(await fetch(`/api/parts/shells:oauth_handler/codex/models?sourceName=${encodeURIComponent(sourceName)}`))
}

/**
 * 取消登录。
 * @param {string} state - OAuth state。
 * @returns {Promise<object>} 空对象。
 */
export async function cancelOAuth(state) {
	return readJson(await fetch('/api/parts/shells:oauth_handler/cancel', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ state }),
	}))
}
