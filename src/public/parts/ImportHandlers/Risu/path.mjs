import fs from 'node:fs'
import path from 'node:path'

import { getUserDictionary } from '../../../../server/auth/index.mjs'
import { uninstallPartBase } from '../../../../server/parts_loader.mjs'

/**
 * 解析部件的绝对路径
 * @param {any} username 用户名
 * @param {any} type 类型
 * @param {any} name 名称
 * @returns {string} 解析后的路径
 */
export function resolvePath(username, type, name) {
	const userPath = path.resolve(getUserDictionary(username))
	const partPath = path.resolve(userPath, type, name)
	const relativePath = path.relative(userPath, partPath)
	if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath))
		throw new Error('Invalid part path')
	return partPath
}

/**
 * 获取一个可用的部件路径，如果已存在则先卸载
 * @param {any} username 用户名
 * @param {any} type 类型
 * @param {any} name 名称
 * @returns {Promise<string>} 可用路径
 */
export async function getAvailablePath(username, type, name) {
	const targetPath = resolvePath(username, type, name)
	if (fs.existsSync(targetPath))
		await uninstallPartBase(username, type, name)
	return targetPath
}
