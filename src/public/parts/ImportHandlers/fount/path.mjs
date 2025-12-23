import fs from 'node:fs'
import path from 'node:path'

import { getUserDictionary } from '../../../../server/auth.mjs'
import { unloadPart } from '../../../../server/parts_loader.mjs'

/**
 * 解析部件的绝对路径。
 * @param {string} username - 用户名。
 * @param {string} type - 部件类型。
 * @param {string} name - 部件名称。
 * @returns {string} - 部件的绝对路径。
 */
export function resolvePath(username, type, name) {
	const userPath = getUserDictionary(username)
	const partPath = path.join(userPath, type, name)
	return partPath
}

/**
 * 获取一个可用的部件路径，如果已存在则先卸载。
 * @param {string} username - 用户名。
 * @param {string} type - 部件类型。
 * @param {string} name - 部件名称。
 * @returns {Promise<string>} - 可用的部件路径。
 */
export async function getAvailablePath(username, type, name) {
	const targetPath = resolvePath(username, type, name)
	if (fs.existsSync(targetPath))
		await unloadPart(username, type + '/' + name, {})
	return targetPath
}
