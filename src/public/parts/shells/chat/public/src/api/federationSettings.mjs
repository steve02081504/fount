/**
 * 【文件】public/src/api/federationSettings.mjs
 * 【职责】本节点联邦设置 REST：读取与更新 relay、省电、identity 等。
 * 【原理】GET/PUT /api/p2p/federation，credentials include。
 * 【数据结构】enabled、relayUrls[]、batterySaver、activePubKeyHex 等 JSON。
 * 【关联】hub/federation/federationModal.mjs、dmLink.mjs、friendChat.mjs。
 */
const FEDERATION_SETTINGS_URL = '/api/p2p/federation'

/**
 * 读取本节点联邦设置。
 * @returns {Promise<object>} 设置 JSON
 */
export async function getFederationSettings() {
	const response = await fetch(FEDERATION_SETTINGS_URL, { credentials: 'include' })
	if (!response.ok) {
		const data = await response.json().catch(() => ({}))
		throw new Error(data.error || 'Failed to load federation settings')
	}
	return response.json()
}

/**
 * 更新本节点联邦设置。
 * @param {object} body 请求体
 * @returns {Promise<object>} 服务端响应
 */
export async function putFederationSettings(body) {
	const response = await fetch(FEDERATION_SETTINGS_URL, {
		method: 'PUT',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
	if (!response.ok) {
		const data = await response.json().catch(() => ({}))
		throw new Error(data.error || 'Failed to save federation settings')
	}
	return response.json()
}
