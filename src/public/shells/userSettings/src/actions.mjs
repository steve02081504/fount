import fs from 'node:fs/promises'
import path from 'node:path'

import { changeUserPassword, revokeUserDeviceByJti, getUserDictionary, getUserByUsername as getUserConfig, renameUser, deleteUserAccount, generateApiKey, revokeApiKey } from '../../../server/auth.mjs'

/**
 * 用户设置相关的动作。
 */

/**
 * 计算目录的大小。
 * @param {string} directoryPath - 目录路径。
 * @returns {Promise<number>} - 目录大小（字节）。
 */
async function getDirectorySize(directoryPath) {
	let totalSize = 0
	try {
		const dirents = await fs.readdir(directoryPath, { withFileTypes: true })
		for (const dirent of dirents) {
			const fullPath = path.join(directoryPath, dirent.name)
			if (dirent.isDirectory()) totalSize += await getDirectorySize(fullPath)
			else if (dirent.isFile()) totalSize += (await fs.stat(fullPath)).size
		}
	}
	catch (error) {
		if (error.code !== 'ENOENT') console.warn(`Error calculating size for ${directoryPath}: ${error.message}`)
		return 0
	}
	return totalSize
}

/**
 * 格式化字节大小。
 * @param {number} bytes - 字节数。
 * @param {number} [decimals=2] - 小数位数。
 * @returns {string} - 格式化后的大小字符串。
 */
function formatBytes(bytes, decimals = 2) {
	if (!bytes) return '0 Bytes'
	const k = 1024
	const dm = decimals < 0 ? 0 : decimals
	const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
	const i = Math.floor(Math.log(bytes) / Math.log(k))
	return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

/**
 * 可用的动作。
 * @property {function} get-stats - 获取用户统计信息。
 * @property {function} change-password - 更改用户密码。
 * @property {function} list-devices - 列出用户设备。
 * @property {function} revoke-device - 撤销用户设备。
 * @property {function} rename-user - 重命名用户。
 * @property {function} delete-account - 删除用户帐户。
 * @property {function} list-apikeys - 列出 API 密钥。
 * @property {function} create-apikey - 创建 API 密钥。
 * @property {function} revoke-apikey - 撤销 API 密钥。
 */
export const actions = {
	/**
			 * 获取用户统计信息。
	 * @param {object} params - 参数。
	 * @param {string} params.user - 用户。
	 * @returns {Promise<object>} - 统计信息。
	 */
	'get-stats': async ({ user }) => {
		const userConfig = getUserConfig(user)
		const userDirectory = getUserDictionary(user)
		const folderSize = await getDirectorySize(userDirectory)
		return {
			username: user,
			creationDate: userConfig.createdAt,
			folderSize: formatBytes(folderSize),
			folderPath: userDirectory
		}
	},
	/**
			 * 更改用户密码。
	 * @param {object} params - 参数。
	 * @param {string} params.user - 用户。
	 * @param {string} params.currentPassword - 当前密码。
	 * @param {string} params.newPassword - 新密码。
	 * @returns {Promise<object>} - 更改结果。
	 */
	'change-password': async ({ user, currentPassword, newPassword }) => {
		if (!currentPassword || !newPassword) throw new Error('Current and new passwords are required.')
		return await changeUserPassword(user, currentPassword, newPassword)
	},
	/**
			 * 列出用户设备。
	 * @param {object} params - 参数。
	 * @param {string} params.user - 用户。
	 * @returns {object[]} - 设备列表。
	 */
	'list-devices': ({ user }) => {
		const userConfig = getUserConfig(user)
		return userConfig.auth.refreshTokens
	},
	/**
			 * 撤销用户设备。
	 * @param {object} params - 参数。
	 * @param {string} params.user - 用户。
	 * @param {string} params.tokenJti - 令牌 JTI。
	 * @param {string} params.password - 密码。
	 * @returns {Promise<object>} - 撤销结果。
	 */
	'revoke-device': async ({ user, tokenJti, password }) => {
		if (!tokenJti || !password) throw new Error('Token JTI and password are required.')
		return await revokeUserDeviceByJti(user, tokenJti, password)
	},
	/**
			 * 重命名用户。
	 * @param {object} params - 参数。
	 * @param {string} params.user - 用户。
	 * @param {string} params.newUsername - 新用户名。
	 * @param {string} params.password - 密码。
	 * @returns {Promise<object>} - 重命名结果。
	 */
	'rename-user': async ({ user, newUsername, password }) => {
		if (!newUsername || !password) throw new Error('New username and password are required.')
		return await renameUser(user, newUsername, password)
	},
	/**
			 * 删除用户帐户。
	 * @param {object} params - 参数。
	 * @param {string} params.user - 用户。
	 * @param {string} params.password - 密码。
	 * @returns {Promise<object>} - 删除结果。
	 */
	'delete-account': async ({ user, password }) => {
		if (!password) throw new Error('Password is required.')
		return await deleteUserAccount(user, password)
	},
	/**
			 * 列出 API 密钥。
	 * @param {object} params - 参数。
	 * @param {string} params.user - 用户。
	 * @returns {object[]} - API 密钥列表。
	 */
	'list-apikeys': ({ user }) => {
		const userConfig = getUserConfig(user)
		return userConfig.auth.apiKeys || []
	},
	/**
			 * 创建 API 密钥。
	 * @param {object} params - 参数。
	 * @param {string} params.user - 用户。
	 * @param {string} params.description - 描述。
	 * @returns {Promise<object>} - 创建结果。
	 */
	'create-apikey': async ({ user, description }) => {
		if (!description) throw new Error('Description is required.')
		const { apiKey } = await generateApiKey(user, description)
		return { apiKey, message: 'Store it securely, it will not be shown again.' }
	},
	/**
			 * 撤销 API 密钥。
	 * @param {object} params - 参数。
	 * @param {string} params.user - 用户。
	 * @param {string} params.jti - JTI。
	 * @returns {Promise<object>} - 撤销结果。
	 */
	'revoke-apikey': async ({ user, jti }) => {
		if (!jti) throw new Error('JTI of the key to revoke is required.')
		return await revokeApiKey(user, jti)
	}
}
