import { initPart, loadPartBase, uninstallPartBase, unloadPartBase } from '../parts_loader.mjs'

/**
 * 加载一个导入处理器。
 * @param {string} username - 用户的用户名。
 * @param {string} tempname - 导入处理器的名称。
 * @returns {Promise<import('../../decl/importHandlerAPI.ts').importHandlerAPI_t>} 一个解析为已加载导入处理器的承诺。
 */
export async function LoadImportHandler(username, tempname) {
	return await loadPartBase(username, 'ImportHandlers', tempname)
}

/**
 * 卸载一个导入处理器。
 * @param {string} username - 用户的用户名。
 * @param {string} tempname - 导入处理器的名称。
 * @param {any} reason - 卸载导入处理器的原因。
 * @returns {Promise<void>} 一个在导入处理器卸载后解析的承诺。
 */
export async function UnloadImportHandler(username, tempname, reason) {
	await unloadPartBase(username, 'ImportHandlers', tempname, reason)
}

/**
 * 初始化一个导入处理器。
 * @param {string} username - 用户的用户名。
 * @param {string} tempname - 导入处理器的名称。
 * @returns {Promise<void>} 一个在导入处理器初始化后解析的承诺。
 */
export async function initImportHandler(username, tempname) {
	await initPart(username, 'ImportHandlers', tempname)
}

/**
 * 卸载一个导入处理器。
 * @param {string} username - 用户的用户名。
 * @param {string} tempname - 导入处理器的名称。
 * @returns {Promise<void>} 一个在导入处理器卸载后解析的承诺。
 */
export async function uninstallImportHandler(username, tempname) {
	await uninstallPartBase(username, 'ImportHandlers', tempname)
}
