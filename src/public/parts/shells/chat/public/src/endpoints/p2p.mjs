/**
 * 【文件】public/src/endpoints/p2p.mjs
 * 【职责】浏览器侧 P2P / 联邦节点 REST（非 chat shell 前缀，仍归 chat Hub 使用面）。
 */

/**
 * @param {string} path 以 / 开头，相对 /api/p2p
 * @param {RequestInit & { json?: object }} [options] fetch 选项
 * @returns {Promise<any>} JSON
 */
async function p2pFetch(path, options = {}) {
	const { json, ...init } = options
	const response = await fetch(`/api/p2p${path}`, {
		credentials: 'include',
		headers: json ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
		body: json ? JSON.stringify(json) : init.body,
		...init,
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
	return p2pFetch('/federation')
}

/**
 * 更新本节点联邦设置。
 * @param {object} body 请求体
 * @returns {Promise<object>} 服务端响应
 */
export function putFederationSettings(body) {
	return p2pFetch('/federation', { method: 'PUT', json: body })
}

/**
 * 写入节点 denylist。
 * @param {object} entry denylist 条目
 * @returns {Promise<any>} 响应
 */
export function addDenylistEntry(entry) {
	return p2pFetch('/denylist', { method: 'POST', json: entry })
}

/**
 * 连接联邦节点。
 * @param {object} body 连接参数
 * @returns {Promise<any>} 响应
 */
export function connectFederationNode(body) {
	return p2pFetch('/federation/connect-node', { method: 'POST', json: body })
}
