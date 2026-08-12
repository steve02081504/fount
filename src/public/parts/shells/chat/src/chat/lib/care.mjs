import { assignShellData, loadShellData } from '../../../../../../../server/setting_loader.mjs'

/**
 * @param {string} username 用户
 * @returns {Record<string, string[]>} owner → cared entityHashes
 */
function loadCareMap(username) {
	return loadShellData(username, 'chat', 'care') ?? {}
}

/**
 * @param {string} username 用户
 * @param {Record<string, string[]>} map owner → cared
 * @returns {void}
 */
function saveCareMap(username, map) {
	assignShellData(username, 'chat', 'care', map)
}

/**
 * @param {string} username 用户
 * @param {string} ownerEntityHash 关心列表所有者
 * @returns {Promise<string[]>} cared entityHashes（小写）
 */
export async function listCared(username, ownerEntityHash) {
	const owner = (ownerEntityHash || '')
	const map = loadCareMap(username)
	return [...new Set((map[owner] || []).map(entry => entry).filter(Boolean))]
}

/**
 * @param {string} username 用户
 * @param {string} ownerEntityHash 关心列表所有者
 * @param {string} targetEntityHash 目标实体
 * @param {boolean} cared 是否关心
 * @returns {Promise<void>}
 */
export async function setCared(username, ownerEntityHash, targetEntityHash, cared) {
	const owner = (ownerEntityHash || '')
	const target = (targetEntityHash || '')
	if (!owner || !target) return
	const map = { ...loadCareMap(username) }
	const list = new Set((map[owner] || []).map(entry => entry).filter(Boolean))
	if (cared) list.add(target)
	else list.delete(target)
	map[owner] = [...list]
	saveCareMap(username, map)
}

/**
 * @param {string} username 用户
 * @param {string} ownerEntityHash 关心列表所有者
 * @param {string} targetEntityHash 目标实体
 * @returns {Promise<boolean>} 是否关心
 */
export async function isCaredBy(username, ownerEntityHash, targetEntityHash) {
	const owner = (ownerEntityHash || '')
	const target = (targetEntityHash || '')
	if (!owner || !target) return false
	return (await listCared(username, owner)).includes(target)
}
