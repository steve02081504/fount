import fs_promises from 'node:fs/promises'
import path from 'node:path'

import * as jose from 'npm:jose'

import {
	authenticate, getUserByReq,
	changeUserPassword, revokeUserDeviceByJti,
	renameUser, deleteUserAccount,
	getUserDictionary, getUserByUsername as getUserConfig,
	mutationResponseHttpStatus,
	REFRESH_TOKEN_EXPIRY_DURATION,
	verifyPassword,
} from '../../../../../server/auth.mjs'
import {
	listWebAuthnCredentials,
	removeWebAuthnCredential,
	webauthnRegistrationBegin,
	webauthnRegistrationComplete,
} from '../../../../../server/webauthn.mjs'

import {
	getAvailableEditorById,
	getEditorCommandConfig,
	openEditor,
	setEditorCommandConfig,
} from './editorCommand.mjs'

/**
 * 用户设置 shell 的 API 端点。
 */

/**
 * 计算目录的大小。
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
 * 设置 userSettings shell 的 API 端点。
 * @param {object} router - Express 路由实例。
 */
export function setEndpoints(router) {
	router.get('/api/parts/shells\\:userSettings/stats', authenticate, async (req, res) => {
		const userReqData = await getUserByReq(req)
		if (!userReqData) return res.status(401).json({ success: false, i18nKey: 'userSettings.shell.unauthorized' })

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

	router.post('/api/parts/shells\\:userSettings/change_password', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		if (!user) return res.status(401).json({ success: false, i18nKey: 'userSettings.shell.unauthorized' })
		const { currentPassword, newPassword } = req.body
		if (!currentPassword || !newPassword)
			return res.status(400).json({ success: false, i18nKey: 'userSettings.changePassword.missingFields' })

		const result = await changeUserPassword(user.username, currentPassword, newPassword)
		res.status(mutationResponseHttpStatus(result)).json(result)
	})

	router.get('/api/parts/shells\\:userSettings/devices', authenticate, async (req, res) => {
		const userReqData = await getUserByReq(req)
		if (!userReqData) return res.status(401).json({ success: false, i18nKey: 'userSettings.shell.unauthorized' })

		const userFullConfig = getUserConfig(userReqData.username)
		if (!userFullConfig?.auth?.refreshTokens) return res.json({ success: true, devices: [] })

		let currentRefreshJti = null
		try {
			currentRefreshJti = jose.decodeJwt(req.cookies?.refreshToken).jti ?? null
		} catch { /* 无效 cookie，忽略 */ }

		const devices = userFullConfig.auth.refreshTokens.map(token => ({
			deviceId: token.deviceId,
			jti: token.jti,
			expiry: token.expiry,
			lastSeen: token.lastSeen || (token.expiry - REFRESH_TOKEN_EXPIRY_DURATION),
			ipAddress: token.ipAddress,
			userAgent: token.userAgent,
			isCurrentSession: Boolean(currentRefreshJti && token.jti === currentRefreshJti),
		})).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))

		res.json({ success: true, devices })
	})

	router.post('/api/parts/shells\\:userSettings/revoke_device', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		if (!user) return res.status(401).json({ success: false, i18nKey: 'userSettings.shell.unauthorized' })
		const { tokenJti, password } = req.body
		if (!tokenJti || !password)
			return res.status(400).json({ success: false, i18nKey: 'userSettings.userDevices.revokeMissingParams' })

		const result = await revokeUserDeviceByJti(user.username, tokenJti, password)
		res.status(mutationResponseHttpStatus(result)).json(result)
	})

	router.post('/api/parts/shells\\:userSettings/rename_user', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		if (!user) return res.status(401).json({ success: false, i18nKey: 'userSettings.shell.unauthorized' })
		const { newUsername, password } = req.body
		if (!newUsername || !password)
			return res.status(400).json({ success: false, i18nKey: 'userSettings.renameUser.missingParams' })

		const result = await renameUser(user.username, newUsername, password)
		if (result.success) {
			res.clearCookie('accessToken', { httpOnly: true, secure: req.secure || req.headers['x-forwarded-proto'] === 'https', sameSite: 'Lax' })
			res.clearCookie('refreshToken', { httpOnly: true, secure: req.secure || req.headers['x-forwarded-proto'] === 'https', sameSite: 'Lax' })
		}
		res.status(mutationResponseHttpStatus(result)).json(result)
	})

	router.post('/api/parts/shells\\:userSettings/delete_account', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		if (!user) return res.status(401).json({ success: false, i18nKey: 'userSettings.shell.unauthorized' })
		const { password } = req.body
		if (!password) return res.status(400).json({ success: false, i18nKey: 'userSettings.deleteAccount.missingPassword' })

		const result = await deleteUserAccount(user.username, password)
		if (result.success) {
			res.clearCookie('accessToken', { httpOnly: true, secure: req.secure || req.headers['x-forwarded-proto'] === 'https', sameSite: 'Lax' })
			res.clearCookie('refreshToken', { httpOnly: true, secure: req.secure || req.headers['x-forwarded-proto'] === 'https', sameSite: 'Lax' })
		}
		res.status(mutationResponseHttpStatus(result)).json(result)
	})

	router.get('/api/parts/shells\\:userSettings/webauthn_credentials', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		if (!user) return res.status(401).json({ success: false, i18nKey: 'userSettings.shell.unauthorized' })
		res.json({ success: true, credentials: listWebAuthnCredentials(user.username) })
	})

	router.get('/api/parts/shells\\:userSettings/editor_command', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' })
		const config = await getEditorCommandConfig(user.username)
		res.json({ success: true, config })
	})

	router.post('/api/parts/shells\\:userSettings/editor_command', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' })
		const { editorId, command, argsTemplate } = req.body || {}
		const editorPreset = getAvailableEditorById(editorId)
		const merged = {
			editorId,
			command: command || editorPreset?.command,
			argsTemplate: argsTemplate || editorPreset?.argsTemplate,
		}
		const config = await setEditorCommandConfig(user.username, merged)
		res.json({ success: true, config })
	})

	router.post('/api/parts/shells\\:userSettings/open_editor', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' })
		const { filePath, line, column } = req.body || {}
		const result = await openEditor(user.username, filePath, line, column)
		res.json(result)
	})

	router.post('/api/parts/shells\\:userSettings/webauthn_register_begin', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		if (!user) return res.status(401).json({ success: false, i18nKey: 'userSettings.shell.unauthorized' })
		const { password } = req.body
		if (!await verifyPassword(password, user.auth.password))
			return res.status(401).json({ success: false, i18nKey: 'userSettings.passkeys.apiInvalidPassword' })
		const result = await webauthnRegistrationBegin(user.username, req)
		res.status(result.status).json(result)
	})

	router.post('/api/parts/shells\\:userSettings/webauthn_register_complete', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		if (!user) return res.status(401).json({ success: false, i18nKey: 'userSettings.shell.unauthorized' })
		const { credential, nickname, password } = req.body
		if (!await verifyPassword(password, user.auth.password))
			return res.status(401).json({ success: false, i18nKey: 'userSettings.passkeys.apiInvalidPassword' })
		if (!credential)
			return res.status(400).json({ success: false, i18nKey: 'userSettings.passkeys.apiMissingCredential' })
		const result = await webauthnRegistrationComplete(user.username, credential, nickname, req)
		res.status(result.status).json(result)
	})

	router.post('/api/parts/shells\\:userSettings/webauthn_remove', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		if (!user) return res.status(401).json({ success: false, i18nKey: 'userSettings.shell.unauthorized' })
		const { credentialId, password } = req.body
		if (!credentialId || !password)
			return res.status(400).json({ success: false, i18nKey: 'userSettings.passkeys.apiRemoveParamsRequired' })
		const result = await removeWebAuthnCredential(user.username, credentialId, password)
		res.status(mutationResponseHttpStatus(result)).json(result)
	})
}
