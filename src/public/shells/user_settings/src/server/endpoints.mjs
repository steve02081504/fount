import {
	authenticate, getUserByReq,
	changeUserPassword, revokeUserDeviceByJti,
	renameUser, deleteUserAccount,
	getUserDictionary, getUserByUsername as getUserConfig,
	logout as authLogout // 导入 auth.mjs 中的 logout 函数
} from '../../../../../server/auth.mjs'
import { REFRESH_TOKEN_EXPIRY_DURATION } from '../../../../../server/auth.mjs'
import fs_promises from 'node:fs/promises'
import path from 'node:path'
import { ms } from '../../../../../scripts/ms.mjs'

// Helper to calculate directory size
async function getDirectorySize(directoryPath) {
	let totalSize = 0
	try {
		const dirents = await fs_promises.readdir(directoryPath, { withFileTypes: true })
		for (const dirent of dirents) {
			const fullPath = path.join(directoryPath, dirent.name)
			if (dirent.isDirectory())
				totalSize += await getDirectorySize(fullPath)
			else if (dirent.isFile())
				try {
					const stats = await fs_promises.stat(fullPath)
					totalSize += stats.size
				} catch (statError) {
					// console.warn(`Could not stat file ${fullPath}: ${statError.message}`);
				}

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


export function setEndpoints(router) {
	router.get('/api/shells/user_settings/stats', authenticate, async (req, res) => {
		const userReqData = await getUserByReq(req)
		if (!userReqData) return res.status(401).json({ success: false, message: 'Unauthorized' })

		const userFullConfig = getUserConfig(userReqData.username)
		const userDirectory = getUserDictionary(userReqData.username)

		try {
			let creationDate = userFullConfig?.createdAt || Date.now()
			try {
				const dirStats = await fs_promises.stat(userDirectory)
				if (!userFullConfig?.createdAt && dirStats?.birthtimeMs) creationDate = dirStats.birthtimeMs
			} catch (dirError) { /* Dir might not exist yet, use now or config */ }

			const folderSizeNum = await getDirectorySize(userDirectory)
			const folderSize = formatBytes(folderSizeNum)

			res.json({
				success: true,
				username: userReqData.username,
				creationDate,
				folderSize,
				folderPath: userDirectory
			})
		} catch (error) {
			console.error('User Settings Shell: Error fetching user stats:', error)
			res.status(500).json({ success: false, message: 'Error fetching user statistics.' })
		}
	})

	router.post('/api/shells/user_settings/change_password', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' })
		const { currentPassword, newPassword } = req.body
		if (!currentPassword || !newPassword) return res.status(400).json({ success: false, message: 'Missing fields.' })

		const result = await changeUserPassword(user.username, currentPassword, newPassword)
		res.status(result.success ? 200 : result.message.includes('Invalid current password') ? 401 : 400 ).json(result)
	})

	router.get('/api/shells/user_settings/devices', authenticate, async (req, res) => {
		const userReqData = await getUserByReq(req)
		if (!userReqData) return res.status(401).json({ success: false, message: 'Unauthorized' })

		const userFullConfig = getUserConfig(userReqData.username)
		// let currentRefreshTokenJti = null // 这个信息现在由客户端自行判断或从服务端获取后比较
		// try {
		// 	const refreshTokenCookie = req.cookies.refreshToken
		// 	if (refreshTokenCookie) currentRefreshTokenJti = jose.decodeJwt(refreshTokenCookie)?.jti
		// } catch(e) { /* ignore */ }

		if (!userFullConfig?.auth?.refreshTokens)
			return res.json({ success: true, devices: [] })

		const devices = userFullConfig.auth.refreshTokens.map(token => ({
			deviceId: token.deviceId,
			jti: token.jti,
			expiry: token.expiry,
			lastSeen: token.lastSeen || (token.expiry - ms(REFRESH_TOKEN_EXPIRY_DURATION)),
			ipAddress: token.ipAddress,
			userAgent: token.userAgent,
		})).sort((a,b) => (b.lastSeen || 0) - (a.lastSeen || 0) )

		res.json({ success: true, devices })
	})

	router.post('/api/shells/user_settings/revoke_device', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' })
		const { tokenJti, password } = req.body
		if (!tokenJti || !password) return res.status(400).json({ success: false, message: 'Token JTI and password required.' })

		const result = await revokeUserDeviceByJti(user.username, tokenJti, password)
		res.status(result.success ? 200 : result.message.includes('Invalid password') ? 401 : 400 ).json(result)
	})

	router.post('/api/shells/user_settings/rename_user', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' })
		const { newUsername, password } = req.body
		if (!newUsername || !password) return res.status(400).json({ success: false, message: 'New username and password required.' })

		const result = await renameUser(user.username, newUsername, password)
		if (result.success) {
			res.clearCookie('accessToken', { httpOnly: true, secure: req.secure || req.headers['x-forwarded-proto'] === 'https', sameSite: 'Lax' })
			res.clearCookie('refreshToken', { httpOnly: true, secure: req.secure || req.headers['x-forwarded-proto'] === 'https', sameSite: 'Lax' })
		}
		res.status(result.success ? 200 : result.message.includes('Invalid password') ? 401 : 400 ).json(result)
	})

	router.post('/api/shells/user_settings/delete_account', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' })
		const { password } = req.body
		if (!password) return res.status(400).json({ success: false, message: 'Password required.' })

		const result = await deleteUserAccount(user.username, password)
		if (result.success) {
			res.clearCookie('accessToken', { httpOnly: true, secure: req.secure || req.headers['x-forwarded-proto'] === 'https', sameSite: 'Lax' })
			res.clearCookie('refreshToken', { httpOnly: true, secure: req.secure || req.headers['x-forwarded-proto'] === 'https', sameSite: 'Lax' })
		}
		res.status(result.success ? 200 : result.message.includes('Invalid password') ? 401 : 400 ).json(result)
	})

	// 新增：登出API端点
	// authenticate 中间件会确保 req.user 和 cookie 信息是有效的
	router.post('/api/shells/user_settings/logout', authenticate, async (req, res) => {
		// authLogout 函数期望 req 和 res 对象，它会处理 token 撤销和 cookie 清理
		await authLogout(req, res)
		// authLogout 内部会发送响应，所以这里不需要再发送
	})
}
