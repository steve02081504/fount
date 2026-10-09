/**
 * 【文件】scripts/endpoints/p2p/federation.mjs
 * 【职责】本节点 P2P 联邦设置 REST（`/api/p2p/federation`）：读取 / 更新联邦视图（活跃公钥、中继、DM 介绍 nonce 等）。
 */

/**
 * @param {string} [path=''] 相对 `/api/p2p/federation` 的子路径
 * @param {RequestInit & { json?: object }} [options] fetch 选项
 * @returns {Promise<any>} JSON
 */
async function federationFetch(path = '', options = {}) {
	const { json, ...init } = options
	const headers = json
		? { 'Content-Type': 'application/json', ...init.headers }
		: init.headers
	const response = await fetch(`/api/p2p/federation${path}`, {
		...init,
		credentials: 'include',
		headers,
		body: json ? JSON.stringify(json) : init.body,
	})
	if (!response.ok) {
		const data = await response.json().catch(() => ({}))
		throw new Error(data.error || `HTTP ${response.status}`)
	}
	if (response.status === 204) return null
	const text = await response.text()
	if (!text) return null
	return JSON.parse(text)
}

/**
 * 读取本节点联邦设置。
 * @returns {Promise<object>} 设置 JSON
 */
export function getFederationSettings() {
	return federationFetch()
}

/**
 * 更新本节点联邦设置。
 * @param {object} body 请求体
 * @returns {Promise<object>} 服务端响应
 */
export function putFederationSettings(body) {
	return federationFetch('', { method: 'PUT', json: body })
}
