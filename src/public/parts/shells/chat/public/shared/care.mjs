import { listCaredEntities, setCaredEntity } from '../src/endpoints/prefs.mjs'

/** @type {Promise<string[]> | null} */
let caredCache = null

/**
 * @returns {Promise<string[]>} cared entityHashes（恒为 operator）
 */
export function listCared() {
	caredCache ??= listCaredEntities().catch((error) => {
		caredCache = null
		throw error
	})
	return caredCache
}

/**
 * @param {string} targetEntityHash 目标
 * @param {boolean} cared 是否关心
 * @returns {Promise<string[]>} 更新后的列表
 */
export async function setCared(targetEntityHash, cared) {
	const next = await setCaredEntity(targetEntityHash, cared)
	caredCache = Promise.resolve(next)
	return next
}

/**
 * @param {string} targetEntityHash 目标
 * @returns {Promise<boolean>} 是否已关心该实体
 */
export async function isCared(targetEntityHash) {
	const cared = await listCared()
	return cared.includes(String(targetEntityHash || '').trim().toLowerCase())
}
