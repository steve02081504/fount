import { getAnyDefaultPart, loadPartBase, uninstallPartBase, unloadPartBase } from '../parts_loader.mjs'

/**
 * 为用户加载一个角色。
 * @param {string} username - 用户的用户名。
 * @param {string} personaname - 角色的名称。
 * @returns {Promise<any>} 一个解析为已加载角色的承诺。
 */
export async function loadPersona(username, personaname) {
	return loadPartBase(username, 'personas', personaname)
}

/**
 * 为用户卸载一个角色。
 * @param {string} username - 用户的用户名。
 * @param {string} personaname - 角色的名称。
 * @returns {Promise<void>} 一个在角色卸载后解析的承诺。
 */
export async function unloadPersona(username, personaname) {
	await unloadPartBase(username, 'personas', personaname)
}

/**
 * 为用户卸载一个角色。
 * @param {string} username - 用户的用户名。
 * @param {string} personaname - 角色的名称。
 * @returns {Promise<void>} 一个在角色卸载后解析的承诺。
 */
export async function uninstallPersona(username, personaname) {
	return uninstallPartBase(username, 'personas', personaname)
}

/**
 * 为用户加载默认角色。
 * @param {string} username - 用户的用户名。
 * @returns {Promise<any>} 一个解析为已加载角色的承诺。
 */
export async function loadDefaultPersona(username) {
	const defaultPersonaName = getAnyDefaultPart(username, 'personas')
	if (!defaultPersonaName) return
	return loadPersona(username, defaultPersonaName)
}
