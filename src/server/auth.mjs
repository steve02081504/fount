import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import argon2 from 'npm:argon2'
import fse from 'npm:fs-extra'
import * as jose from 'npm:jose'

import { console } from '../scripts/i18n.mjs'
import { loadJsonFile } from '../scripts/json_loader.mjs'
import { ms } from '../scripts/ms.mjs'

import { __dirname } from './base.mjs'
import { events } from './events.mjs'
import { partsList } from './managers/base.mjs'
import { config, save_config, data_path } from './server.mjs'

const ACCESS_TOKEN_EXPIRY = '15m' // Access Token 有效期
export const REFRESH_TOKEN_EXPIRY = '30d' // Refresh Token 有效期 (字符串形式)
export const REFRESH_TOKEN_EXPIRY_DURATION = ms(REFRESH_TOKEN_EXPIRY) // Refresh Token 有效期 (毫秒数)
const ACCOUNT_LOCK_TIME = '10m' // 账户锁定时间
const MAX_LOGIN_ATTEMPTS = 5 // 最大登录尝试次数
const BRUTE_FORCE_THRESHOLD = 8 // Brute force threshold
const BRUTE_FORCE_FAKE_SUCCESS_RATE = 1 / 3 // 1/3 chance of fake success

let privateKey, publicKey // 用于JWT签名的密钥对
const loginFailures = {} // { [ip]: count }
const jwtCache = new Map()
const JWT_CACHE_SIZE = 32

function genNewKeyPair() {
	const { privateKey: newPrivateKey, publicKey: newPublicKey } = crypto.generateKeyPairSync('ec', {
		namedCurve: 'prime256v1',
	})

	const newPrivateKeyPEM = newPrivateKey.export({ type: 'pkcs8', format: 'pem' })
	const newPublicKeyPEM = newPublicKey.export({ type: 'spki', format: 'pem' })

	return {
		privateKey: newPrivateKeyPEM,
		publicKey: newPublicKeyPEM
	}
}
async function importKeyPair(keyPair) {
	return {
		privateKey: await jose.importPKCS8(keyPair.privateKey, 'ES256'),
		publicKey: await jose.importSPKI(keyPair.publicKey, 'ES256'),
	}
}
async function getFakePrivateKey() {
	let fakeKeyPair
	do fakeKeyPair = genNewKeyPair()
	while (fakeKeyPair.privateKey == config.privateKey)
	const importedFakeKeyPair = await importKeyPair(fakeKeyPair)
	return importedFakeKeyPair.privateKey
}

/**
 * 初始化认证模块，加载或生成密钥对
 */
export async function initAuth() {
	config.uuid ??= crypto.randomUUID()
	if (!config.privateKey || !config.publicKey)
		Object.assign(config, genNewKeyPair())
	const keyPair = await importKeyPair(config)
	privateKey = keyPair.privateKey
	publicKey = keyPair.publicKey

	config.data.revokedTokens ??= {}
	config.data.apiKeys ??= {}
	config.data.users ??= {}
	for (const user in config.data.users)
		if (config.data.users[user].auth) {
			config.data.users[user].auth.refreshTokens ??= []
			config.data.users[user].auth.apiKeys ??= []
		}

	cleanupRevokedTokens()
	cleanupRefreshTokens()
}

/**
 * 生成 JWT (Access Token)
 * @param {object} payload - 令牌的有效载荷
 * @returns {Promise<string>} Access Token
 */
export async function generateAccessToken(payload, signingKey = privateKey) {
	const jti = crypto.randomUUID() // 为 Access Token 生成唯一标识符
	return await new jose.SignJWT({ ...payload, jti })
		.setProtectedHeader({ alg: 'ES256' })
		.setIssuedAt()
		.setExpirationTime(ACCESS_TOKEN_EXPIRY)
		.sign(signingKey)
}

/**
 * 生成刷新令牌 (Refresh Token)
 * @param {object} payload - 令牌的有效载荷
 * @param {string} deviceId - 设备的唯一标识符
 * @returns {Promise<string>} Refresh Token
 */
async function generateRefreshToken(payload, deviceId = 'unknown', signingKey = privateKey) {
	const refreshTokenId = crypto.randomUUID() // JTI for refresh token
	const tokenPayload = {
		...payload,
		jti: refreshTokenId,
		deviceId,
	}
	// 不直接在 JWT payload 中存储 IP 和 UserAgent，这些信息存储在服务器端的 refreshTokens 数组中
	return await new jose.SignJWT(tokenPayload)
		.setProtectedHeader({ alg: 'ES256' })
		.setIssuedAt()
		.setExpirationTime(REFRESH_TOKEN_EXPIRY)
		.sign(signingKey)
}

/**
 * 验证 JWT (包括 Access Token 和 Refresh Token)
 * @param {string} token - 要验证的 JWT
 * @returns {Promise<object|null>} 解码后的 payload 或 null
 */
async function verifyToken(token) {
	if (jwtCache.has(token)) {
		const cachedPayload = jwtCache.get(token)
		// Check expiry from cached payload
		if (cachedPayload.exp * 1000 > Date.now()) {
			// Also need to re-check if revoked, as revocation status can change
			if (config.data.revokedTokens[cachedPayload.jti]) {
				jwtCache.delete(token) // remove from cache if revoked
				return null
			}
			// Move to end of map to mark as recently used
			jwtCache.delete(token)
			jwtCache.set(token, cachedPayload)
			return cachedPayload
		}
		// Token expired, remove from cache
		jwtCache.delete(token)
	}
	try {
		const { payload } = await jose.jwtVerify(token, publicKey, {
			algorithms: ['ES256'],
		})
		// 检查令牌是否已被撤销 (针对 access token 和 refresh token 统一检查)
		if (config.data.revokedTokens[payload.jti]) {
			console.warnI18n('fountConsole.auth.tokenRevoked', { jti: payload.jti })
			return null
		}

		// Add to cache
		if (jwtCache.size >= JWT_CACHE_SIZE) {
			// delete oldest entry
			const oldestKey = jwtCache.keys().next().value
			jwtCache.delete(oldestKey)
		}
		jwtCache.set(token, payload)

		return payload
	} catch (error) {
		console.errorI18n('fountConsole.auth.tokenVerifyError', { error })
		return null
	}
}

/**
 * 刷新 Access Token
 * @param {string} refreshTokenValue - 客户端传入的 Refresh Token
 * @param {object} req - Express 请求对象, 用于获取 IP 和 User-Agent
 * @returns {Promise<object>} 包含状态码、新令牌或错误消息的对象
 */
async function refresh(refreshTokenValue, req) {
	try {
		const decoded = await verifyToken(refreshTokenValue) // verifyToken 内部已检查全局 revokedTokens
		if (!decoded) return { status: 401, success: false, message: 'Invalid or revoked refresh token' }

		const user = getUserByUsername(decoded.username)
		if (!user || !user.auth || !user.auth.refreshTokens)
			return { status: 401, success: false, message: 'User not found or refresh tokens unavailable' }

		const userRefreshTokenEntry = user.auth.refreshTokens.find(token => token.jti === decoded.jti)

		// 再次验证 refreshToken 是否存在于用户记录中，以及 deviceId 是否匹配
		if (!userRefreshTokenEntry || userRefreshTokenEntry.deviceId !== decoded.deviceId) {
			// 如果 JTI 存在于用户记录中但 deviceId 不匹配，这可能是一个安全问题，撤销该 JTI
			if (userRefreshTokenEntry) await revokeToken(refreshTokenValue, 'refresh-device-mismatch')

			return { status: 401, success: false, message: 'Refresh token not found for user or device mismatch' }
		}

		// 更新 lastSeen, ipAddress, userAgent for the current token entry
		userRefreshTokenEntry.lastSeen = Date.now()
		if (req?.ip) userRefreshTokenEntry.ipAddress = req.ip
		if (req?.headers?.['user-agent']) userRefreshTokenEntry.userAgent = req.headers['user-agent']

		// 生成新的 access token
		const accessToken = await generateAccessToken({ username: decoded.username, userId: decoded.userId })

		// (可选) 滚动刷新 Refresh Token：生成新的 Refresh Token，并使旧的失效
		// 为了简化，并减少客户端状态管理，这里可以不滚动刷新 Refresh Token，而是沿用旧的，直到它过期
		// 如果决定滚动：
		const newRefreshToken = await generateRefreshToken({ username: decoded.username, userId: decoded.userId }, userRefreshTokenEntry.deviceId)
		const decodedNewRefreshToken = jose.decodeJwt(newRefreshToken)
		// 移除旧的 refreshToken，添加新的 refreshToken
		user.auth.refreshTokens = user.auth.refreshTokens.filter(token => token.jti !== decoded.jti)
		user.auth.refreshTokens.push({
			jti: decodedNewRefreshToken.jti,
			deviceId: userRefreshTokenEntry.deviceId,
			expiry: decodedNewRefreshToken.exp * 1000, // 从JWT payload获取过期时间
			ipAddress: req?.ip,
			userAgent: req?.headers?.['user-agent'],
			lastSeen: Date.now()
		})
		save_config()
		return { status: 200, success: true, accessToken, refreshToken: newRefreshToken }
	} catch (error) {
		console.errorI18n('fountConsole.auth.refreshTokenError', { error: error.message })
		return { status: 401, success: false, message: 'Error refreshing token' }
	}
}

/**
 * 用户登出
 * @param {object} req - Express 请求对象
 * @param {object} res - Express 响应对象
 */
export async function logout(req, res) {
	const { cookies: { accessToken, refreshToken } } = req
	const user = await getUserByReq(req) // 使用 getUserByReq 获取用户信息

	if (accessToken) await revokeToken(accessToken, 'access-logout')

	if (refreshToken && user) {
		const userConfig = getUserByUsername(user.username) // 获取完整的用户配置
		if (userConfig?.auth?.refreshTokens)
			try {
				const decodedRefreshToken = await jose.decodeJwt(refreshToken) // 仅解码，不验证，因为可能已过期但仍需从用户列表中移除
				if (decodedRefreshToken?.jti) {
					// 从用户的 refreshToken 列表中移除当前的 refreshToken
					const tokenIndex = userConfig.auth.refreshTokens.findIndex(token => token.jti === decodedRefreshToken.jti)
					if (tokenIndex !== -1) userConfig.auth.refreshTokens.splice(tokenIndex, 1)

					// 将其添加到全局 revokedTokens
					await revokeToken(refreshToken, 'refresh-logout')
				}
			} catch (error) {
				console.errorI18n('fountConsole.auth.logoutRefreshTokenProcessError', { error: error.message })
			}
	}

	res.clearCookie('accessToken', { httpOnly: true, secure: req.secure || req.headers['x-forwarded-proto'] === 'https', sameSite: 'Lax' })
	res.clearCookie('refreshToken', { httpOnly: true, secure: req.secure || req.headers['x-forwarded-proto'] === 'https', sameSite: 'Lax' })
	save_config()
	res.status(200).json({ success: true, message: 'Logout successful' })
}

/**
 * 验证请求
 * @param {object} req - Express 请求对象
 * @param {object} res - Express 响应对象
 * @returns {Promise<void>} - 只在成功时resolve
 */
export async function verifyApiKey(apiKey) {
	try {
		const hash = crypto.createHash('sha256').update(apiKey).digest('hex')
		const keyInfo = config.data.apiKeys[hash]

		if (!keyInfo) return null

		const user = getUserByUsername(keyInfo.username)
		if (!user) {
			// Data inconsistency, key exists but user doesn't. Clean it up.
			delete config.data.apiKeys[hash]
			save_config()
			return null
		}

		// Update last used time
		const userKeyInfo = user.auth.apiKeys.find(k => k.jti === keyInfo.jti)
		if (userKeyInfo) userKeyInfo.lastUsed = Date.now()

		return user
	} catch (error) {
		console.error('API key verification error:', error)
		return null
	}
}

export async function try_auth_request(req, res) {
	if (req.user) return

	const Unauthorized = (message = 'Unauthorized') => { console.error(message); throw message }

	// API Key Authentication
	let apiKey
	if (req.ws) apiKey = req.headers['sec-websocket-protocol']?.split?.(',')?.[0]?.trim?.()
	else {
		const authHeader = req.headers.authorization
		if (authHeader?.startsWith?.('Bearer ')) apiKey = authHeader.substring(7)
		if (!apiKey) apiKey = req.query?.['fount-apikey']
	}

	if (apiKey) {
		const user = await verifyApiKey(apiKey)
		if (user) { req.user = user; return }
		return Unauthorized('Invalid API Key')
	}

	const { accessToken, refreshToken } = req.cookies

	if (!accessToken) return Unauthorized()

	let decodedAccessToken = await verifyToken(accessToken)

	if (!decodedAccessToken) {
		// accessToken 无效或已过期，尝试使用 refreshToken 刷新
		if (!refreshToken) return Unauthorized('Access token invalid, no refresh token provided.')

		const refreshResult = await refresh(refreshToken, req) // 传入 req
		if (refreshResult.status !== 200 || !refreshResult.success) {
			// refreshToken 也无效，需要重新登录
			res.clearCookie('accessToken', { httpOnly: true, secure: req.secure || req.headers['x-forwarded-proto'] === 'https', sameSite: 'Lax' })
			res.clearCookie('refreshToken', { httpOnly: true, secure: req.secure || req.headers['x-forwarded-proto'] === 'https', sameSite: 'Lax' })
			return Unauthorized(refreshResult.message || 'Session expired, please login again.')
		}

		// 刷新成功，设置新的 accessToken 和 refreshToken 到 Cookie
		res.cookie('accessToken', refreshResult.accessToken, { httpOnly: true, secure: req.secure || req.headers['x-forwarded-proto'] === 'https', sameSite: 'Lax' })
		res.cookie('refreshToken', refreshResult.refreshToken, { httpOnly: true, secure: req.secure || req.headers['x-forwarded-proto'] === 'https', sameSite: 'Lax' })

		req.cookies.accessToken = refreshResult.accessToken // 更新当前请求的cookies对象，供后续逻辑使用
		req.cookies.refreshToken = refreshResult.refreshToken // 如果滚动了，也更新

		// 使用新的 accessToken 重新验证
		decodedAccessToken = await verifyToken(refreshResult.accessToken)
		if (!decodedAccessToken) return Unauthorized('Failed to verify newly refreshed token.') // 安全检查
	}

	req.user = config.data.users[decodedAccessToken.username]
	return
}
/**
 * 验证请求
 * @param {object} req - Express 请求对象
 * @param {object} res - Express 响应对象
 * @returns {Promise<boolean>} - 成功返回true，失败返回false
 */
export function auth_request(req, res) {
	return try_auth_request(req, res).then(_ => true, _ => false)
}

/**
 * 身份验证中间件
 * @param {object} req - Express 请求对象
 * @param {object} res - Express 响应对象
 * @param {function} next - Express next middleware 函数
 */
export async function authenticate(req, res, next) {
	const Unauthorized = (message = 'Unauthorized') => {
		const path = encodeURIComponent(req.originalUrl)
		if (req.accepts('html') && req.method === 'GET') return res.redirect(`/login?redirect=${path}`) // 只对GET HTML请求重定向
		return res.status(401).json({ success: false, message, error: message })
	}

	try {
		await try_auth_request(req, res)
		return next()
	} catch (e) {
		return Unauthorized(e)
	}
}

/**
 * 撤销令牌 (将 Access Token 或 Refresh Token 添加到撤销列表)
 * @param {string} token - 要撤销的令牌
 * @param {string} typeSuffix - 撤销原因的后缀 (e.g., 'logout', 'manual')
 */
async function revokeToken(token, typeSuffix = 'unknown') {
	try {
		const decoded = await jose.decodeJwt(token) // 仅解码以获取 jti 和 exp
		if (!decoded || !decoded.jti) {
			console.errorI18n('fountConsole.auth.revokeTokenNoJTI')
			return
		}

		const tokenType = decoded.exp ?
			decoded.exp * 1000 - (decoded.iat ? decoded.iat * 1000 : Date.now() - ms('1m')) > ms(ACCESS_TOKEN_EXPIRY) + ms('1m') ? 'refresh' : 'access'
			: 'unknown' // 尝试根据典型有效期猜测类型

		const expiry = decoded.exp ? decoded.exp * 1000 : Date.now() + ms(REFRESH_TOKEN_EXPIRY) // 如果没有exp，假设是长期有效的需要被记录

		config.data.revokedTokens[decoded.jti] = {
			expiry,
			type: `${tokenType}-${typeSuffix}`,
			revokedAt: Date.now()
		}
		save_config()
	} catch (e) {
		console.error(`Error decoding token for revocation: ${e.message}`)
	}
}

/**
 * 通过用户名获取完整的用户信息对象
 * @param {string} username - 用户名
 * @returns {object|undefined} 用户对象或 undefined
 */
export function getUserByUsername(username) {
	return config.data.users[username]
}

/**
 * 获取所有用户名列表
 * @returns {string[]}
 */
export function getAllUserNames() {
	return Object.keys(config.data.users)
}

/**
 * 获取所有用户对象的字典
 * @returns {object}
 */
export function getAllUsers() {
	return config.data.users
}

/**
 * 创建新用户
 * @param {string} username - 用户名
 * @param {string} password - 密码
 * @returns {Promise<object>} 创建的用户对象 (包含 userId)
 */
async function createUser(username, password) {
	const hashedPassword = await hashPassword(password)
	const userId = crypto.randomUUID()
	const now = Date.now()
	config.data.users[username] = {
		username,
		createdAt: now, // 添加 createdAt 字段
		auth: {
			userId,
			password: hashedPassword,
			loginAttempts: 0,
			lockedUntil: null,
			refreshTokens: [], // 初始化 refreshTokens 数组
			apiKeys: [],
		},
		// 合并默认用户模板
		...loadJsonFile(path.join(__dirname, 'default', 'templates', 'user.json')),
	}

	save_config()
	return config.data.users[username]
}

/**
 * 使用 Argon2id 哈希密码
 * @param {string} password - 明文密码
 * @returns {Promise<string>} 哈希后的密码
 */
export async function hashPassword(password) {
	return await argon2.hash(password, { type: argon2.argon2id })
}

/**
 * 验证密码
 * @param {string} password - 用户输入的明文密码
 * @param {string} hashedPassword - 存储的哈希密码
 * @returns {Promise<boolean>} 密码是否匹配
 */
export async function verifyPassword(password, hashedPassword) {
	if (!password || !hashedPassword) return false
	return await argon2.verify(hashedPassword, password)
}

/**
 * 修改用户密码
 * @param {string} username - 用户名
 * @param {string} currentPassword - 当前密码
 * @param {string} newPassword - 新密码
 * @returns {Promise<object>} 操作结果 { success: boolean, message: string }
 */
export async function changeUserPassword(username, currentPassword, newPassword) {
	const user = getUserByUsername(username)
	if (!user || !user.auth) return { success: false, message: 'User not found' }

	const isValidPassword = await verifyPassword(currentPassword, user.auth.password)
	if (!isValidPassword) return { success: false, message: 'Invalid current password' }

	user.auth.password = await hashPassword(newPassword)
	save_config()
	return { success: true, message: 'Password changed successfully' }
}

/**
 * 生成 API Key
 * @param {string} username
 * @param {string} description
 * @returns {Promise<{apiKey: string, jti: string}>}
 */
export async function generateApiKey(username, description = 'New API Key') {
	const user = getUserByUsername(username)
	if (!user) throw new Error('User not found')

	const apiKey = `${crypto.randomBytes(32).toString('base64url')}`
	const hash = crypto.createHash('sha256').update(apiKey).digest('hex')
	const jti = crypto.randomUUID()
	const now = Date.now()

	config.data.apiKeys ??= {}
	// Add to global lookup table
	config.data.apiKeys[hash] = {
		username,
		jti,
	}

	user.auth.apiKeys ??= []
	// Add to user's list of keys (for management)
	user.auth.apiKeys.push({
		jti,
		description,
		createdAt: now,
		lastUsed: null,
		prefix: apiKey.substring(0, 7), // Store a prefix for identification e.g., Abc123
	})

	save_config()

	return { apiKey, jti } // Return plaintext key and its JTI
}

/**
 * 撤销 API Key
 * @param {string} username
 * @param {string} jti
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function revokeApiKey(username, jti) {
	const user = getUserByUsername(username)
	if (!user || !user.auth || !user.auth.apiKeys)
		return { success: false, message: 'User or API keys not found' }

	const keyIndex = user.auth.apiKeys.findIndex(key => key.jti === jti)
	if (keyIndex === -1)
		return { success: false, message: 'API key not found for this user' }

	// Find the hash to remove from the global table by JTI
	const hashToRemove = Object.keys(config.data.apiKeys).find(
		hash => config.data.apiKeys[hash].jti === jti,
	)

	if (hashToRemove) delete config.data.apiKeys[hashToRemove]

	user.auth.apiKeys.splice(keyIndex, 1)
	save_config()

	return { success: true, message: 'API key revoked successfully' }
}


/**
 * 根据 JTI 撤销用户的某个设备（Refresh Token）
 * 需要用户密码进行验证
 * @param {string} username - 用户名
 * @param {string} tokenJti - 要撤销的 Refresh Token 的 JTI
 * @param {string} password - 用户密码，用于验证操作权限
 * @returns {Promise<object>} 操作结果 { success: boolean, message: string }
 */
export async function revokeUserDeviceByJti(username, tokenJti, password) {
	const user = getUserByUsername(username)
	if (!user || !user.auth || !user.auth.refreshTokens)
		return { success: false, message: 'User or device list not found' }

	// 验证用户密码
	const isValidPassword = await verifyPassword(password, user.auth.password)
	if (!isValidPassword)
		return { success: false, message: 'Invalid password for user action' }

	const tokenIndex = user.auth.refreshTokens.findIndex(token => token.jti === tokenJti)
	if (tokenIndex === -1)
		return { success: false, message: 'Device (JTI) not found for this user' }

	const revokedToken = user.auth.refreshTokens.splice(tokenIndex, 1)[0]
	if (revokedToken && revokedToken.jti)
		// 全局撤销这个JTI
		config.data.revokedTokens[revokedToken.jti] = {
			expiry: Date.now() + REFRESH_TOKEN_EXPIRY_DURATION, // 或使用 token.expiry
			type: 'refresh-revoked-by-user-jti',
			revokedAt: Date.now()
		}

	save_config()
	return { success: true, message: 'Device access (JTI) revoked successfully' }
}

/**
 * 删除用户账户及数据，需要密码验证
 * @param {string} username - 要删除的用户名
 * @param {string} password - 用户密码
 * @returns {Promise<object>} 操作结果 { success: boolean, message: string }
 */
export async function deleteUserAccount(username, password) {
	const user = getUserByUsername(username)
	if (!user || !user.auth)
		return { success: false, message: 'User not found.' }

	const isValidPassword = await verifyPassword(password, user.auth.password)
	if (!isValidPassword)
		return { success: false, message: 'Invalid password for deleting account.' }

	await events.emit('BeforeUserDeleted', { username })

	// 撤销用户所有的 refresh tokens
	if (user.auth.refreshTokens && user.auth.refreshTokens.length > 0)
		user.auth.refreshTokens.forEach(token => {
			if (token.jti)
				config.data.revokedTokens[token.jti] = {
					expiry: Date.now() + REFRESH_TOKEN_EXPIRY_DURATION,
					type: 'refresh-revoked-account-delete',
					revokedAt: Date.now()
				}
		})

	// 从配置中删除用户数据
	delete config.data.users[username]
	save_config()

	const userDirectoryPath = getUserDictionary(username) // 在从配置中删除用户前获取路径

	// 删除用户数据目录
	if (fs.existsSync(userDirectoryPath))
		fs.rmSync(userDirectoryPath, { recursive: true, force: true })

	await events.emit('AfterUserDeleted', { username })

	return { success: true, message: 'User account deleted successfully. Associated data will be cleaned up.' }
}

/**
 * 重命名用户账户，需要密码验证
 * @param {string} currentUsername - 当前用户名
 * @param {string} newUsername - 新用户名
 * @param {string} password - 用户密码
 * @returns {Promise<object>} 操作结果 { success: boolean, message: string }
 */
export async function renameUser(currentUsername, newUsername, password) {
	const user = getUserByUsername(currentUsername)
	if (!user || !user.auth)
		return { success: false, message: 'Current user not found.' }

	const isValidPassword = await verifyPassword(password, user.auth.password)
	if (!isValidPassword)
		return { success: false, message: 'Invalid password for renaming user.' }

	if (currentUsername === newUsername)
		return { success: false, message: 'New username must be different from the current one.' }

	const oldUserConfigEntry = getUserByUsername(currentUsername)
	if (!oldUserConfigEntry)
		return { success: false, message: 'Current user not found' }

	if (getUserByUsername(newUsername))
		return { success: false, message: 'New username already exists' }

	await events.emit('BeforeUserRenamed', { oldUsername: currentUsername, newUsername })

	const oldUserPath = getUserDictionary(currentUsername) // 获取旧路径

	// 深拷贝用户配置
	const newUserConfigEntry = JSON.parse(JSON.stringify(oldUserConfigEntry))
	newUserConfigEntry.username = newUsername // 更新用户名

	const newUserPath = path.resolve(newUserConfigEntry.UserDictionary || path.join(__dirname, 'data', 'users', newUsername))

	try {
		if (fse.existsSync(oldUserPath))
			if (oldUserPath.toLowerCase() !== newUserPath.toLowerCase()) { // 路径不同才移动
				fse.ensureDirSync(path.dirname(newUserPath)) // 确保目标目录的父目录存在
				fse.moveSync(oldUserPath, newUserPath, { overwrite: true })
				console.log(`User data directory moved from ${oldUserPath} to ${newUserPath}`)
			} else
				console.log(`User data directory path is effectively the same (case-insensitive), no move needed: ${oldUserPath}`)
		else {
			console.warn(`Old user data directory not found: ${oldUserPath}. Nothing to move.`)
			// 即使旧目录不存在，也应确保新目录存在
			if (!fse.existsSync(newUserPath)) {
				fse.ensureDirSync(newUserPath)
				console.log(`Ensured new user data directory exists at: ${newUserPath}`)
			}
		}
	} catch (error) {
		console.error(`Error moving user data directory from ${oldUserPath} to ${newUserPath}:`, error)
		// 如果移动失败，不应该保存配置更改，以避免数据和配置不一致
		return { success: false, message: `Error moving user data directory: ${error.message}. Username change not saved.` }
	}

	// 更新配置
	config.data.users[newUsername] = newUserConfigEntry
	delete config.data.users[currentUsername]
	save_config()

	await events.emit('AfterUserRenamed', {
		oldUsername: currentUsername,
		newUsername,
	})

	return { success: true, message: 'Username renamed successfully and user data directory potentially moved.' }
}


/**
 * 从请求中获取用户信息（username, userId）
 * 依赖 authenticate 中间件已填充 req.user
 * @param {object} req - Express 请求对象
 * @returns {Promise<object|undefined>} 用户对象或 undefined
 */
export async function getUserByReq(req) {
	if (!req.user) throw new Error('Request is not authenticated. Make sure to use the authenticate middleware.')
	return req.user
}

/**
 * 获取用户的数据目录路径
 * @param {string} username - 用户名
 * @returns {string} 用户数据目录的绝对路径
 */
export function getUserDictionary(username) {
	const user = config.data.users[username]
	return path.resolve(user?.UserDictionary || path.join(data_path, 'users', username))
}

let avgVerifyTime = (_ => {
	const startTime = Date.now()
	argon2.verify('$argon2id$v=19$m=65536,t=3,p=4$ZHVtbXlkYXRh$ZHVtbXlkYXRhZGF0YQ', 'dummydata').catch(() => { })
	return Date.now() - startTime
})()
/**
 * 用户登录
 * @param {string} username - 用户名
 * @param {string} password - 密码
 * @param {string} deviceId - 设备标识符，用于区分不同设备的会话
 * @param {object} req - Express 请求对象, 用于获取 IP 和 User-Agent
 * @returns {Promise<object>} 包含状态码、消息、令牌的对象
 */
export async function login(username, password, deviceId = 'unknown', req) {
	const ip = req.ip
	const user = getUserByUsername(username)
	async function failedLogin(local_return = {}) {
		loginFailures[ip] = (loginFailures[ip] || 0) + 1

		if (loginFailures[ip] >= BRUTE_FORCE_THRESHOLD && Math.random() < BRUTE_FORCE_FAKE_SUCCESS_RATE) {
			const fakePrivateKey = await getFakePrivateKey()
			const userId = crypto.randomUUID()
			const accessToken = await generateAccessToken({ username, userId }, fakePrivateKey)
			const refreshTokenString = await generateRefreshToken({ username, userId }, deviceId, fakePrivateKey)
			return { status: 200, success: true, message: 'Login successful', accessToken, refreshToken: refreshTokenString }
		}
		// 防止计时攻击
		await new Promise(resolve => setTimeout(resolve, avgVerifyTime * 0.8 + (Math.random() - 0.5) * avgVerifyTime * 0.2))
		return Object.assign({ status: 401, success: false, message: 'Invalid username or password' }, local_return)
	}
	if (!user) return await failedLogin({ status: 401, success: false, message: 'User not found' })

	const authData = user.auth

	if (authData.lockedUntil && authData.lockedUntil > Date.now()) {
		const timeLeft = ms(authData.lockedUntil - Date.now(), { long: true })
		return { status: 403, success: false, message: `Account locked. Try again in ${timeLeft}.` }
	}

	const startTime = Date.now()
	const isValidPassword = await verifyPassword(password, authData.password)
	avgVerifyTime = (avgVerifyTime * 3 + (Date.now() - startTime)) / 4
	if (!isValidPassword) {
		authData.loginAttempts = (authData.loginAttempts || 0) + 1
		if (authData.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
			authData.lockedUntil = Date.now() + ms(ACCOUNT_LOCK_TIME)
			authData.loginAttempts = 0 // 达到最大尝试次数后重置
			save_config()
			console.logI18n('fountConsole.auth.accountLockedLog', { username })
			return { status: 403, success: false, message: `Account locked due to too many failed attempts. Try again in ${ms(ms(ACCOUNT_LOCK_TIME), { long: true })}.` }
		}
		return await failedLogin()
	}

	delete loginFailures[ip]

	authData.loginAttempts = 0
	authData.lockedUntil = null

	// 创建用户目录 (如果尚不存在)
	const userdir = getUserDictionary(username)
	if (!fs.existsSync(userdir)) try {
		fs.mkdirSync(path.dirname(userdir), { recursive: true })
		// 自`/default/user`复制到用户目录
		fse.copySync(path.join(__dirname, '/default/templates/user'), userdir)
	} catch { }
	for (const subdir of ['settings', ...partsList])
		try { fs.mkdirSync(userdir + '/' + subdir, { recursive: true }) } catch (error) {
			console.error('Failed to create directory:', userdir + '/' + subdir, error)
		}

	// 生成 access token 和 refresh token
	const accessToken = await generateAccessToken({ username: user.username, userId: authData.userId })
	const refreshTokenString = await generateRefreshToken({ username: user.username, userId: authData.userId }, deviceId)
	const decodedRefreshToken = jose.decodeJwt(refreshTokenString) // 解码 refreshToken 以获取 jti 和 exp

	// 移除同一个设备上的旧的 refresh token (如果策略是每个设备只保留一个会话)
	authData.refreshTokens = authData.refreshTokens.filter(token => token.deviceId !== deviceId)

	// 存储新的 refresh token 信息
	authData.refreshTokens.push({
		jti: decodedRefreshToken.jti,
		deviceId,
		expiry: decodedRefreshToken.exp * 1000, // 从JWT payload获取过期时间 (秒转毫秒)
		ipAddress: req?.ip,
		userAgent: req?.headers?.['user-agent'],
		lastSeen: Date.now()
	})
	save_config()

	return { status: 200, success: true, message: 'Login successful', accessToken, refreshToken: refreshTokenString }
}

/**
 * 用户注册
 * @param {string} username - 用户名
 * @param {string} password - 密码
 * @returns {Promise<object>} 包含状态码和用户信息的对象
 */
export async function register(username, password) {
	const existingUser = getUserByUsername(username)
	if (existingUser?.auth)  // 检查 .auth 是为了确保这是一个完整的用户记录，而不仅仅是配置中的某个键
		return { status: 409, success: false, message: 'Username already exists' }

	const newUser = await createUser(username, password) // createUser 内部处理保存
	return { status: 201, success: true, user: { username: newUser.username, userId: newUser.auth.userId, createdAt: newUser.createdAt } }
}

/**
 * 清理过期的已撤销 token (例如，每小时调用一次)
 */
function cleanupRevokedTokens() {
	const now = Date.now()
	let cleaned = false
	for (const jti in config.data.revokedTokens)
		if (config.data.revokedTokens[jti].expiry <= now) {
			delete config.data.revokedTokens[jti]
			cleaned = true
		}

	if (cleaned) save_config()
}

/**
 * 清理用户配置中过期的 refresh token (例如，每小时调用一次)
 */
function cleanupRefreshTokens() {
	const now = Date.now()
	let cleaned = false
	for (const username in config.data.users) {
		const user = config.data.users[username]
		if (user?.auth?.refreshTokens) {
			const initialLength = user.auth.refreshTokens.length
			user.auth.refreshTokens = user.auth.refreshTokens.filter(token => {
				const stillValid = token.expiry > now
				const notGloballyRevoked = !config.data.revokedTokens[token.jti]
				return stillValid && notGloballyRevoked
			})
			if (user.auth.refreshTokens.length !== initialLength) cleaned = true
		}
	}

	if (cleaned) save_config()
}

function cleanupLoginFailures() {
	for (const ip in loginFailures)
		if (loginFailures[ip] < MAX_LOGIN_ATTEMPTS) delete loginFailures[ip]
		else loginFailures[ip] -= MAX_LOGIN_ATTEMPTS
}

// 定时清理任务
setInterval(() => {
	cleanupRevokedTokens()
	cleanupRefreshTokens()
	cleanupLoginFailures()
}, ms('1h'))
