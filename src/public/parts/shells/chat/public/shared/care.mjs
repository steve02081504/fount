import { CHAT_API_CLIENT_PREFIX } from './apiPaths.mjs'

const CARE_API = `${CHAT_API_CLIENT_PREFIX}/care`

/**
 * @param {string} [ownerEntityHash] 所有者 entityHash
 * @returns {Promise<string[]>} cared entityHashes
 */
export async function listCared(ownerEntityHash) {
	const query = ownerEntityHash ? `?ownerEntityHash=${encodeURIComponent(ownerEntityHash)}` : ''
	const response = await fetch(`${CARE_API}${query}`, { credentials: 'include' })
	const data = await response.json()
	if (!response.ok) throw new Error(data.error || 'load care failed')
	return Array.isArray(data.cared) ? data.cared : []
}

/**
 * @param {string} ownerEntityHash 所有者
 * @param {string} targetEntityHash 目标
 * @param {boolean} cared 是否关心
 * @returns {Promise<string[]>} 更新后的列表
 */
export async function setCared(ownerEntityHash, targetEntityHash, cared) {
	const response = await fetch(CARE_API, {
		method: 'PUT',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ownerEntityHash, targetEntityHash, cared }),
	})
	const data = await response.json()
	if (!response.ok) throw new Error(data.error || 'set care failed')
	return Array.isArray(data.cared) ? data.cared : []
}

/**
 * @param {string} ownerEntityHash 所有者
 * @param {string} targetEntityHash 目标
 * @returns {Promise<boolean>}
 */
export async function isCared(ownerEntityHash, targetEntityHash) {
	const cared = await listCared(ownerEntityHash)
	return cared.includes(String(targetEntityHash || '').trim().toLowerCase())
}
