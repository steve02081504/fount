import { initPart, loadPartBase, uninstallPartBase, unloadPartBase } from '../parts_loader.mjs'

/**
 * 为用户加载一个 plugin。
 * @param {string} username - 用户的用户名。
 * @param {string} pluginname - plugin 的名称。
 * @returns {Promise<import('../../decl/pluginAPI.ts').PluginAPI_t>} 一个解析为已加载 plugin 的承诺。
 */
export async function loadPlugin(username, pluginname) {
	return loadPartBase(username, 'plugins', pluginname)
}

/**
 * 为用户卸载一个 plugin。
 * @param {string} username - 用户的用户名。
 * @param {string} pluginname - plugin 的名称。
 * @returns {Promise<void>} 一个在 plugin 卸载后解析的承诺。
 */
export async function unloadPlugin(username, pluginname) {
	await unloadPartBase(username, 'plugins', pluginname)
}

/**
 * 为用户初始化一个 plugin。
 * @param {string} username - 用户的用户名。
 * @param {string} pluginname - plugin 的名称。
 * @returns {Promise<void>} 一个在 plugin 初始化后解析的承诺。
 */
export async function initPlugin(username, pluginname) {
	await initPart(username, 'plugins', pluginname)
}

/**
 * 为用户卸载一个 plugin。
 * @param {string} username - 用户的用户名。
 * @param {string} pluginname - plugin 的名称。
 * @returns {Promise<void>} 一个在 plugin 卸载后解析的承诺。
 */
export async function uninstallPlugin(username, pluginname) {
	await uninstallPartBase(username, 'plugins', pluginname)
}
