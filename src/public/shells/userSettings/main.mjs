import { setEndpoints } from './src/server/endpoints.mjs'
import { changeUserPassword, revokeUserDeviceByJti, getUserDictionary, getUserByUsername as getUserConfig, renameUser, deleteUserAccount } from '../../../../server/auth.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'

async function getDirectorySize(directoryPath) {
	let totalSize = 0
	try {
		const dirents = await fs.readdir(directoryPath, { withFileTypes: true })
		for (const dirent of dirents) {
			const fullPath = path.join(directoryPath, dirent.name)
			if (dirent.isDirectory())
				totalSize += await getDirectorySize(fullPath)
			else if (dirent.isFile())
				totalSize += (await fs.stat(fullPath)).size
		}
	} catch (error) {
		if (error.code !== 'ENOENT') console.warn(`Error calculating size for ${directoryPath}: ${error.message}`)
		return 0
	}
	return totalSize
}

function formatBytes(bytes, decimals = 2) {
	if (bytes === 0) return '0 Bytes'
	const k = 1024
	const dm = decimals < 0 ? 0 : decimals
	const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
	const i = Math.floor(Math.log(bytes) / Math.log(k))
	return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

export default {
	info: {
		'': {
			name: 'user-settings',
			version: '1.0.0',
			author: 'steve02081504',
			description: 'Provides API endpoints for user settings management.'
		}
	},
	Load: async ({ router }) => {
		setEndpoints(router)
	},
	Unload: async () => { },
	interfaces: {
		invokes: {
			ArgumentsHandler: async (user, args) => {
				const action = args[0]

				switch (action) {
					case 'get-stats': {
						const userConfig = getUserConfig(user)
						const userDirectory = getUserDictionary(user)
						const folderSize = await getDirectorySize(userDirectory)
						console.log({
							username: user,
							creationDate: userConfig.createdAt,
							folderSize: formatBytes(folderSize),
							folderPath: userDirectory
						})
						break
					}
					case 'change-password': {
						const currentPassword = args[1]
						const newPassword = args[2]
						if (!currentPassword || !newPassword) throw new Error('Current and new passwords are required.')
						const result = await changeUserPassword(user, currentPassword, newPassword)
						console.log(result.message)
						break
					}
					case 'list-devices': {
						const userConfig = getUserConfig(user)
						console.log(userConfig.auth.refreshTokens)
						break
					}
					case 'revoke-device': {
						const tokenJti = args[1]
						const password = args[2]
						if (!tokenJti || !password) throw new Error('Token JTI and password are required.')
						const result = await revokeUserDeviceByJti(user, tokenJti, password)
						console.log(result.message)
						break
					}
					case 'rename-user': {
						const newUsername = args[1]
						const password = args[2]
						if (!newUsername || !password) throw new Error('New username and password are required.')
						const result = await renameUser(user, newUsername, password)
						console.log(result.message)
						break
					}
					case 'delete-account': {
						const password = args[1]
						if (!password) throw new Error('Password is required.')
						const result = await deleteUserAccount(user, password)
						console.log(result.message)
						break
					}
					default:
						throw new Error(`Unknown action: ${action}. Available actions: get-stats, change-password, list-devices, revoke-device, rename-user, delete-account`)
				}
			},
			IPCInvokeHandler: async (user, { action, currentPassword, newPassword, tokenJti, password, newUsername }) => {
				switch (action) {
					case 'get-stats': {
						const userConfig = getUserConfig(user)
						const userDirectory = getUserDictionary(user)
						const folderSize = await getDirectorySize(userDirectory)
						return {
							username: user,
							creationDate: userConfig.createdAt,
							folderSize: formatBytes(folderSize),
							folderPath: userDirectory
						}
					}
					case 'change-password': {
						if (!currentPassword || !newPassword) throw new Error('Current and new passwords are required.')
						return await changeUserPassword(user, currentPassword, newPassword)
					}
					case 'list-devices': {
						const userConfig = getUserConfig(user)
						return userConfig.auth.refreshTokens
					}
					case 'revoke-device': {
						if (!tokenJti || !password) throw new Error('Token JTI and password are required.')
						return await revokeUserDeviceByJti(user, tokenJti, password)
					}
					case 'rename-user': {
						if (!newUsername || !password) throw new Error('New username and password are required.')
						return await renameUser(user, newUsername, password)
					}
					case 'delete-account': {
						if (!password) throw new Error('Password is required.')
						return await deleteUserAccount(user, password)
					}
					default:
						throw new Error(`Unknown action: ${action}. Available actions: get-stats, change-password, list-devices, revoke-device, rename-user, delete-account`)
				}
			}
		}
	}
}