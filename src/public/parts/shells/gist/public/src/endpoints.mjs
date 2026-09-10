/**
 * gist shell 前端 HTTP 客户端（具名导出，唯一 fetch 入口）。
 */

const API_BASE = '/api/parts/shells:gist'

/**
 * 统一 JSON 请求（失败时抛出带 status 的 Error，供 404 等分支判断）。
 * @param {string} url - 请求地址。
 * @param {RequestInit} [options] - fetch 选项。
 * @returns {Promise<any>} 解析后的 JSON。
 */
async function requestJson(url, options) {
	const response = await fetch(url, options)
	if (!response.ok) {
		const text = await response.text().catch(() => '')
		const error = new Error(`${response.status} ${response.statusText}${text ? `: ${text}` : ''}`)
		error.status = response.status
		throw error
	}
	return response.json()
}

/**
 * 发送 JSON 写请求。
 * @param {string} url - 请求地址。
 * @param {any} body - 请求体。
 * @param {string} [method='POST'] - HTTP 方法。
 * @returns {Promise<any>} 解析后的 JSON。
 */
function sendJson(url, body, method = 'POST') {
	return requestJson(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

/**
 * 列出全部 gist（不含 markdown），按创建时间降序。
 * @returns {Promise<Array<{id: string, title: string, securityLevel: 'secure'|'trusted', source: object|null, createdAt: number, updatedAt: number}>>} gist 列表。
 */
export async function listGists() {
	return requestJson(`${API_BASE}/gists`)
}

/**
 * 新建 gist。
 * @param {{markdown: string, title?: string, securityLevel?: 'secure'|'trusted', source?: object|null}} payload - 创建参数。
 * @returns {Promise<{id: string, title: string, securityLevel: string, source: object|null, createdAt: number, updatedAt: number, markdown: string}>} 新建的 gist。
 */
export async function createGist(payload) {
	const { gist } = await sendJson(`${API_BASE}/gists`, payload)
	return gist
}

/**
 * 读取单个 gist（含 markdown）。
 * @param {string} id - gist id。
 * @returns {Promise<{id: string, title: string, securityLevel: string, source: object|null, createdAt: number, updatedAt: number, markdown: string}>} gist 详情。
 */
export async function getGist(id) {
	const { gist } = await requestJson(`${API_BASE}/gists/${encodeURIComponent(id)}`)
	return gist
}

/**
 * 更新 gist。
 * @param {string} id - gist id。
 * @param {{markdown?: string, title?: string, securityLevel?: 'secure'|'trusted'}} payload - 更新字段。
 * @returns {Promise<{id: string, title: string, securityLevel: string, source: object|null, createdAt: number, updatedAt: number, markdown: string}>} 更新后的 gist。
 */
export async function updateGist(id, payload) {
	const { gist } = await sendJson(`${API_BASE}/gists/${encodeURIComponent(id)}`, payload, 'PUT')
	return gist
}

/**
 * 删除 gist。
 * @param {string} id - gist id。
 * @returns {Promise<{ok: boolean}>} 删除结果。
 */
export async function deleteGist(id) {
	return requestJson(`${API_BASE}/gists/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/**
 * 获取来源插件列表。
 * @returns {Promise<{plugins: Array<object>}>} 来源插件列表。
 */
export async function getSourcePlugins() {
	return requestJson(`${API_BASE}/source-plugins`)
}
