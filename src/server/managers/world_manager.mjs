import { loadPartBase, unloadPartBase } from '../parts_loader.mjs'

/**
 * 为用户加载一个世界。
 * @param {string} username - 用户的用户名。
 * @param {string} worldname - 世界的名称。
 * @returns {Promise<import('../../decl/worldAPI.ts').WorldAPI_t>} 一个解析为已加载世界的承诺。
 */
export function loadWorld(username, worldname) {
	return loadPartBase(username, 'worlds', worldname, {
		username,
		worldname,
	})
}

/**
 * 为用户卸载一个世界。
 * @param {string} username - 用户的用户名。
 * @param {string} worldname - 世界的名称。
 * @returns {Promise<void>} 一个在世界卸载后解析的承诺。
 */
export async function unloadWorld(username, worldname) {
	await unloadPartBase(username, 'worlds', worldname)
}
