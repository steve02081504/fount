import { initPart, loadPartBase, uninstallPartBase, unloadPartBase } from '../parts_loader.mjs'

/**
 * 为用户加载一个 shell。
 * @param {string} username - 用户的用户名。
 * @param {string} shellname - shell 的名称。
 * @returns {Promise<import('../../decl/shellAPI.ts').shellAPI_t>} 一个解析为已加载 shell 的承诺。
 */
export async function loadShell(username, shellname) {
	return loadPartBase(username, 'shells', shellname)
}

/**
 * 为用户卸载一个 shell。
 * @param {string} username - 用户的用户名。
 * @param {string} shellname - shell 的名称。
 * @returns {Promise<void>} 一个在 shell 卸载后解析的承诺。
 */
export async function unloadShell(username, shellname) {
	await unloadPartBase(username, 'shells', shellname)
}

/**
 * 为用户初始化一个 shell。
 * @param {string} username - 用户的用户名。
 * @param {string} shellname - shell 的名称。
 * @returns {Promise<void>} 一个在 shell 初始化后解析的承诺。
 */
export async function initShell(username, shellname) {
	await initPart(username, 'shells', shellname)
}

/**
 * 为用户卸载一个 shell。
 * @param {string} username - 用户的用户名。
 * @param {string} shellname - shell 的名称。
 * @returns {Promise<void>} 一个在 shell 卸载后解析的承诺。
 */
export async function uninstallShell(username, shellname) {
	await uninstallPartBase(username, 'shells', shellname)
}
