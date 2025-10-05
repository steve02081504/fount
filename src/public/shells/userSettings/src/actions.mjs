import fs from 'node:fs/promises'
import path from 'node:path'

import { changeUserPassword, revokeUserDeviceByJti, getUserDictionary, getUserByUsername as getUserConfig, renameUser, deleteUserAccount, generateApiKey, revokeApiKey } from '../../../server/auth.mjs'

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

function formatBytes(bytes, decimals = 2) {
	if (!bytes) return '0 Bytes'
	const k = 1024
	const dm = decimals < 0 ? 0 : decimals
	const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
	const i = Math.floor(Math.log(bytes) / Math.log(k))
	return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

export const actions = {
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
	'change-password': async ({ user, currentPassword, newPassword }) => {
		if (!currentPassword || !newPassword) throw new Error('Current and new passwords are required.')
		return await changeUserPassword(user, currentPassword, newPassword)
	},
	'list-devices': ({ user }) => {
		const userConfig = getUserConfig(user)
		return userConfig.auth.refreshTokens
	},
	'revoke-device': async ({ user, tokenJti, password }) => {
		if (!tokenJti || !password) throw new Error('Token JTI and password are required.')
		return await revokeUserDeviceByJti(user, tokenJti, password)
	},
	'rename-user': async ({ user, newUsername, password }) => {
		if (!newUsername || !password) throw new Error('New username and password are required.')
		return await renameUser(user, newUsername, password)
	},
	'delete-account': async ({ user, password }) => {
		if (!password) throw new Error('Password is required.')
		return await deleteUserAccount(user, password)
	},
	'list-apikeys': ({ user }) => {
		const userConfig = getUserConfig(user)
		return userConfig.auth.apiKeys || []
	},
	'create-apikey': async ({ user, description }) => {
		if (!description) throw new Error('Description is required.')
		const { apiKey } = await generateApiKey(user, description)
		return { apiKey, message: 'Store it securely, it will not be shown again.' }
	},
	'revoke-apikey': async ({ user, jti }) => {
		if (!jti) throw new Error('JTI of the key to revoke is required.')
		return await revokeApiKey(user, jti)
	}
}
