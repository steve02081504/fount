/**
 * 【文件】public/src/endpoints/p2p.mjs
 * 【职责】浏览器侧 P2P REST（denylist / 联邦连接；联邦设置见 federationSettings.mjs）。
 */

/**
 * @param {string} path 以 / 开头，相对 /api/p2p
 * @param {RequestInit & { json?: object }} [options] fetch 选项
 * @returns {Promise<any>} JSON
 */
async function p2pFetch(path, options = {}) {
	const { json, ...init } = options
	const headers = json
		? { 'Content-Type': 'application/json', ...init.headers }
		: init.headers
	const response = await fetch(`/api/p2p${path}`, {
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
