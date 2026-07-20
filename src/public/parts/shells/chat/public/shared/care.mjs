import { CHAT_API_CLIENT_PREFIX } from './apiPaths.mjs'

const CARE_API = `${CHAT_API_CLIENT_PREFIX}/care`

/**
 * @returns {Promise<string[]>} cared entityHashes（恒为 operator）
 */
export async function listCared() {
	const response = await fetch(CARE_API, { credentials: 'include' })
	const data = await response.json()
	if (!response.ok) throw new Error(data.error || 'load care failed')
	return Array.isArray(data.cared) ? data.cared : []
}

/**
 * @param {string} targetEntityHash 目标
 * @param {boolean} cared 是否关心
 * @returns {Promise<string[]>} 更新后的列表
 */
export async function setCared(targetEntityHash, cared) {
	const response = await fetch(CARE_API, {
		method: 'PUT',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ targetEntityHash, cared }),
	})
	const data = await response.json()
	if (!response.ok) throw new Error(data.error || 'set care failed')
	return Array.isArray(data.cared) ? data.cared : []
}

/**
 * @param {string} targetEntityHash 目标
 * @returns {Promise<boolean>} 是否已关心该实体
 */
export async function isCared(targetEntityHash) {
	const cared = await listCared()
	return cared.includes(String(targetEntityHash || '').trim().toLowerCase())
}
