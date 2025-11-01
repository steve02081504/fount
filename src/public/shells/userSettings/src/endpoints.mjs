import fs_promises from 'node:fs/promises'
import path from 'node:path'

import { ms } from '../../../../scripts/ms.mjs'
import {
	authenticate, getUserByReq,
	changeUserPassword, revokeUserDeviceByJti,
	renameUser, deleteUserAccount,
	getUserDictionary, getUserByUsername as getUserConfig,
	REFRESH_TOKEN_EXPIRY_DURATION
} from '../../../../server/auth.mjs'

/**
 * @file userSettings/src/endpoints.mjs
 * @description 用户设置 shell 的 API 端点。
 * @namespace userSettings.endpoints
 */

/**
 * @function getDirectorySize
 * @memberof userSettings.endpoints
 * @description 计算目录的大小。
 * @param {string} directoryPath - 目录路径。
 * @returns {Promise<number>} - 目录大小（字节）。
 */
async function getDirectorySize(directoryPath) {
	let totalSize = 0
	try {
		const dirents = await fs_promises.readdir(directoryPath, { withFileTypes: true })
		for (const dirent of dirents) {
			const fullPath = path.join(directoryPath, dirent.name)
			if (dirent.isDirectory())
				totalSize += await getDirectorySize(fullPath)
			else if (dirent.isFile()) try {
				const stats = await fs_promises.stat(fullPath)
				totalSize += stats.size
			} catch { }
		}
	}
	catch (error) {
		if (error.code !== 'ENOENT') console.warn(`Error calculating size for ${directoryPath}: ${error.message}`)
		return 0
	}
	return totalSize
}

/**
 * @function formatBytes
 * @memberof userSettings.endpoints
 * @description 格式化字节大小。
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
 * @function setEndpoints
 * @memberof userSettings.endpoints
 * @description 设置 userSettings shell 的 API 端点。
 * @param {object} router - Express 路由实例。
 */
export function setEndpoints(router) {
	router.get('/api/shells/userSettings/stats', authenticate, async (req, res) => {
		const userReqData = await getUserByReq(req)
		if (!userReqData) return res.status(401).json({ success: false, message: 'Unauthorized' })

		const userFullConfig = getUserConfig(userReqData.username)
		const userDirectory = getUserDictionary(userReqData.username)

		let creationDate = userFullConfig?.createdAt || Date.now()
		try {
			const dirStats = await fs_promises.stat(userDirectory)
			if (!userFullConfig?.createdAt && dirStats?.birthtimeMs) creationDate = dirStats.birthtimeMs
		} catch (dirError) { /* Dir might not exist yet, use now or config */ }

		const folderSizeNum = getDirectorySize(userDirectory).then(size => userReqData.directorySize = size)
		const folderSize = formatBytes(userReqData.directorySize || await folderSizeNum)

		res.json({
			success: true,
			username: userReqData.username,
			creationDate,
			folderSize,
			folderPath: userDirectory
		})
	})

	router.post('/api/shells/userSettings/change_password', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' })
		const { currentPassword, newPassword } = req.body
		if (!currentPassword || !newPassword) return res.status(400).json({ success: false, message: 'Missing fields.' })

		const result = await changeUserPassword(user.username, currentPassword, newPassword)
		res.status(result.success ? 200 : result.message.includes('Invalid current password') ? 401 : 400).json(result)
	})

	router.get('/api/shells/userSettings/devices', authenticate, async (req, res) => {
		const userReqData = await getUserByReq(req)
		if (!userReqData) return res.status(401).json({ success: false, message: 'Unauthorized' })

		const userFullConfig = getUserConfig(userReqData.username)
		if (!userFullConfig?.auth?.refreshTokens) return res.json({ success: true, devices: [] })

		const devices = userFullConfig.auth.refreshTokens.map(token => ({
			deviceId: token.deviceId,
			jti: token.jti,
			expiry: token.expiry,
			lastSeen: token.lastSeen || (token.expiry - ms(REFRESH_TOKEN_EXPIRY_DURATION)),
			ipAddress: token.ipAddress,
			userAgent: token.userAgent,
		})).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))

		res.json({ success: true, devices })
	})

	router.post('/api/shells/userSettings/revoke_device', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' })
		const { tokenJti, password } = req.body
		if (!tokenJti || !password) return res.status(400).json({ success: false, message: 'Token JTI and password required.' })

		const result = await revokeUserDeviceByJti(user.username, tokenJti, password)
		res.status(result.success ? 200 : result.message.includes('Invalid password') ? 401 : 400).json(result)
	})

	router.post('/api/shells/userSettings/rename_user', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' })
		const { newUsername, password } = req.body
		if (!newUsername || !password) return res.status(400).json({ success: false, message: 'New username and password required.' })

		const result = await renameUser(user.username, newUsername, password)
		if (result.success) {
			res.clearCookie('accessToken', { httpOnly: true, secure: req.secure || req.headers['x-forwarded-proto'] === 'https', sameSite: 'Lax' })
			res.clearCookie('refreshToken', { httpOnly: true, secure: req.secure || req.headers['x-forwarded-proto'] === 'https', sameSite: 'Lax' })
		}
		res.status(result.success ? 200 : result.message.includes('Invalid password') ? 401 : 400).json(result)
	})

	router.post('/api/shells/userSettings/delete_account', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' })
		const { password } = req.body
		if (!password) return res.status(400).json({ success: false, message: 'Password required.' })

		const result = await deleteUserAccount(user.username, password)
		if (result.success) {
			res.clearCookie('accessToken', { httpOnly: true, secure: req.secure || req.headers['x-forwarded-proto'] === 'https', sameSite: 'Lax' })
			res.clearCookie('refreshToken', { httpOnly: true, secure: req.secure || req.headers['x-forwarded-proto'] === 'https', sameSite: 'Lax' })
		}
		res.status(result.success ? 200 : result.message.includes('Invalid password') ? 401 : 400).json(result)
	})
}
