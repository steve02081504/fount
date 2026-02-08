import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { setInterval, setTimeout } from 'node:timers'

import fse from 'npm:fs-extra'
import * as jose from 'npm:jose'

import { console } from '../scripts/i18n.mjs'
import { loadJsonFile } from '../scripts/json_loader.mjs'
import { ms } from '../scripts/ms.mjs'

import { __dirname } from './base.mjs'
import { events } from './events.mjs'
import { config, save_config, data_path } from './server.mjs'

const { hash, verify, Algorithm } = await import('npm:@node-rs/argon2').catch(async error => {
	globalThis.console.warn(error)
	const fallback = await import('npm:argon2')
	return {
		hash: fallback.hash,
		verify: fallback.verify,
		Algorithm: {
			Argon2id: fallback.argon2id
		}
	}
})
/**
 * 此文件处理应用程序的所有认证相关逻辑，
 * 包括用户注册、登录、JWT管理、API密钥验证和密码处理。
 */

// --- 常量定义 ---
const ACCESS_TOKEN_EXPIRY = '1d'
/** @constant {number} 访问令牌的持续时间（毫秒）。 */
export const ACCESS_TOKEN_EXPIRY_DURATION = ms(ACCESS_TOKEN_EXPIRY)
/** @constant {string} 刷新令牌的过期时间。 */
export const REFRESH_TOKEN_EXPIRY = '30d'
/** @constant {number} 刷新令牌的持续时间（毫秒）。 */
export const REFRESH_TOKEN_EXPIRY_DURATION = ms(REFRESH_TOKEN_EXPIRY)
const ACCOUNT_LOCK_TIME = '10m'
const MAX_LOGIN_ATTEMPTS = 5
const BRUTE_FORCE_THRESHOLD = 8
const BRUTE_FORCE_FAKE_SUCCESS_RATE = 1 / 3
const JWT_CACHE_SIZE = 32

// --- 模块级变量 ---

/** @type {jose.KeyLike} */
let privateKey
/** @type {jose.KeyLike} */
let publicKey
/** @type {Object<string, number>} */
const loginFailures = {}
/** @type {Map<string, object>} */
const jwtCache = new Map()

// --- 辅助函数 ---

/**
 * 获取安全的 Cookie 选项，动态判断 'secure' 标志。
 * @param {import('npm:express').Request} req - Express 请求对象。
 * @returns {object} Cookie 选项对象。
 */
export function getSecureCookieOptions(req) {
	const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https'
	return {
		httpOnly: true,
		secure: isSecure,
		sameSite: 'Lax',
	}
}

/**
 * 清除所有认证相关的 Cookies。
 * @param {import('npm:express').Response} res - Express 响应对象。
 * @param {object} options - Cookie 选项。
 */
function clearAuthCookies(res, options) {
	res.clearCookie('accessToken', options)
	res.clearCookie('refreshToken', options)
	res.clearCookie('apiAccessToken', options)
	res.clearCookie('apiRefreshToken', options)
}

/**
 * 生成新的 EC 密钥对 (PEM 格式)。
 * @returns {{privateKey: string, publicKey: string}} 新的密钥对。
 */
function genNewKeyPair() {
	const { privateKey: newPrivateKey, publicKey: newPublicKey } = crypto.generateKeyPairSync('ec', {
		namedCurve: 'prime256v1',
	})
	return {
		privateKey: newPrivateKey.export({ type: 'pkcs8', format: 'pem' }),
		publicKey: newPublicKey.export({ type: 'spki', format: 'pem' }),
	}
}

/**
 * 将 PEM 格式的密钥对导入为 jose 可用的格式。
 * @param {{privateKey: string, publicKey: string}} keyPair - PEM 格式的密钥对。
 * @returns {Promise<{privateKey: jose.KeyLike, publicKey: jose.KeyLike}>} 导入的密钥对。
 */
async function importKeyPair(keyPair) {
	return {
		privateKey: await jose.importPKCS8(keyPair.privateKey, 'ES256'),
		publicKey: await jose.importSPKI(keyPair.publicKey, 'ES256'),
	}
}

/**
 * 为暴力破解防御生成一个临时的、假的私钥。
 * @returns {Promise<jose.KeyLike>} 一个假的私钥。
 */
async function getFakePrivateKey() {
	let fakeKeyPair
	do fakeKeyPair = genNewKeyPair()
	while (fakeKeyPair.privateKey == config.privateKey)
	const importedFakeKeyPair = await importKeyPair(fakeKeyPair)
	return importedFakeKeyPair.privateKey
}

/**
 * 一个通用的 JWT 生成函数。
 * @param {object} payload - 令牌的有效载荷。
 * @param {string | number} expirationTime - 令牌的过期时间 (例如, '1d', '2h', 3600)。
 * @param {jose.KeyLike} [signingKey=privateKey] - 签名密钥。
 * @returns {Promise<string>} 生成的 JWT。
 */
async function generateToken(payload, expirationTime, signingKey = privateKey) {
	const jti = crypto.randomUUID()
	return await new jose.SignJWT({ ...payload, jti })
		.setProtectedHeader({ alg: 'ES256' })
		.setIssuedAt()
		.setExpirationTime(expirationTime)
		.sign(signingKey)
}

// --- 核心认证逻辑 ---

/**
 * 初始化认证模块，加载或生成密钥对并清理数据。
 * @returns {Promise<void>}
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
			config.data.users[user].auth.apiRefreshTokens ??= []
		}


	cleanupRevokedTokens()
	cleanupRefreshTokens()
}

/**
 * 生成一个 JWT 访问令牌。
 * @param {object} payload - 令牌的有效载荷。
 * @param {jose.KeyLike} [signingKey=privateKey] - 签名密钥。
 * @returns {Promise<string>} 生成的访问令牌。
 */
export async function generateAccessToken(payload, signingKey = privateKey) {
	return generateToken(payload, ACCESS_TOKEN_EXPIRY, signingKey)
}

/**
 * 生成一个 API 访问令牌。
 * @param {object} payload - 令牌的有效载荷。
 * @param {jose.KeyLike} [signingKey=privateKey] - 签名密钥。
 * @returns {Promise<string>} 生成的 API 访问令牌。
 */
export async function generateApiAccessToken(payload, signingKey = privateKey) {
	return generateToken({ ...payload, type: 'api' }, ACCESS_TOKEN_EXPIRY, signingKey)
}

/**
 * 生成一个刷新令牌。
 * @param {object} payload - 令牌的有效载荷。
 * @param {string} deviceId - 设备的唯一标识符。
 * @param {jose.KeyLike} [signingKey=privateKey] - 签名密钥。
 * @returns {Promise<string>} 生成的刷新令牌。
 */
async function generateRefreshToken(payload, deviceId = 'unknown', signingKey = privateKey) {
	return generateToken({ ...payload, deviceId }, REFRESH_TOKEN_EXPIRY, signingKey)
}

/**
 * 生成一个 API 刷新令牌。
 * @param {object} payload - 令牌的有效载荷。
 * @param {string} apiKeyJti - 关联的 API 密钥的 JTI。
 * @param {jose.KeyLike} [signingKey=privateKey] - 签名密钥。
 * @returns {Promise<string>} 生成的 API 刷新令牌。
 */
async function generateApiRefreshToken(payload, apiKeyJti, signingKey = privateKey) {
	return generateToken({ ...payload, apiKeyJti, type: 'apiRefresh' }, REFRESH_TOKEN_EXPIRY, signingKey)
}

/**
 * 验证一个 JWT（访问令牌或刷新令牌），支持缓存。
 * @param {string} token - 要验证的 JWT。
 * @returns {Promise<object|null>} 解码后的有效载荷，如果验证失败则返回 null。
 */
async function verifyToken(token) {
	if (jwtCache.has(token)) {
		const cachedPayload = jwtCache.get(token)
		if (cachedPayload.exp * 1000 > Date.now()) {
			if (config.data.revokedTokens[cachedPayload.jti]) {
				jwtCache.delete(token)
				return null
			}
			jwtCache.delete(token)
			jwtCache.set(token, cachedPayload)
			return cachedPayload
		}
		jwtCache.delete(token)
	}
	try {
		const { payload } = await jose.jwtVerify(token, publicKey, { algorithms: ['ES256'] })
		if (config.data.revokedTokens[payload.jti]) {
			console.warnI18n('fountConsole.auth.tokenRevoked', { jti: payload.jti })
			return null
		}

		if (jwtCache.size >= JWT_CACHE_SIZE)
			jwtCache.delete(jwtCache.keys().next().value)

		jwtCache.set(token, payload)

		return payload
	} catch (error) {
		console.errorI18n('fountConsole.auth.tokenVerifyError', { error })
		return null
	}
}

/**
 * 通用的令牌刷新处理器。
 * @param {string} refreshTokenValue - 客户端提供的刷新令牌。
 * @param {import('npm:express').Request} req - Express 请求对象。
 * @param {object} options - 刷新逻辑的配置。
 * @returns {Promise<object>} 包含状态码、新令牌或错误消息的对象。
 */
async function handleTokenRefresh(refreshTokenValue, req, options) {
	try {
		const decoded = await verifyToken(refreshTokenValue)
		if (!decoded || (options.expectedType && decoded.type !== options.expectedType))
			return { status: 401, success: false, message: `Invalid or revoked ${options.tokenName} refresh token` }


		const user = getUserByUsername(decoded.username)
		if (!user || !user.auth || !user.auth[options.userTokenArrayKey])
			return { status: 401, success: false, message: `User not found or ${options.tokenName} refresh tokens unavailable` }


		const tokenEntry = user.auth[options.userTokenArrayKey].find(t => t.jti === decoded.jti)

		if (!tokenEntry || !options.validateEntry(tokenEntry, decoded)) {
			if (tokenEntry) await revokeToken(refreshTokenValue, options.mismatchRevokeReason)
			return { status: 401, success: false, message: `${options.tokenName} refresh token not found or validation mismatch` }
		}

		// 更新条目信息
		tokenEntry.lastSeen = Date.now()
		if (req?.ip) tokenEntry.ipAddress = req.ip
		if (req?.headers?.['user-agent']) tokenEntry.userAgent = req.headers['user-agent']

		// 生成新令牌
		const payload = { username: decoded.username, userId: decoded.userId }
		const newAccessToken = await options.generateAccessToken(payload)
		const newRefreshToken = await options.generateRefreshToken(payload, tokenEntry)
		const decodedNewRefreshToken = jose.decodeJwt(newRefreshToken)

		// 更新用户的令牌列表
		user.auth[options.userTokenArrayKey] = user.auth[options.userTokenArrayKey].filter(t => t.jti !== decoded.jti)
		user.auth[options.userTokenArrayKey].push({
			...options.getNewTokenEntry(decodedNewRefreshToken, tokenEntry),
			ipAddress: req?.ip,
			userAgent: req?.headers?.['user-agent'],
			lastSeen: Date.now(),
		})

		return {
			status: 200,
			success: true,
			[options.accessTokenKey]: newAccessToken,
			[options.refreshTokenKey]: newRefreshToken,
		}
	} catch (error) {
		console.errorI18n(options.errorI18nKey, { error: error.message })
		return { status: 401, success: false, message: `Error refreshing ${options.tokenName} token` }
	}
}

/**
 * 刷新访问令牌。
 * @param {string} refreshTokenValue - 客户端提供的刷新令牌。
 * @param {import('npm:express').Request} req - Express 请求对象。
 * @returns {Promise<object>} 包含刷新结果的对象。
 */
async function refresh(refreshTokenValue, req) {
	return handleTokenRefresh(refreshTokenValue, req, {
		tokenName: 'standard',
		expectedType: undefined,
		userTokenArrayKey: 'refreshTokens',
		/**
		 * 验证令牌条目。
		 * @param {object} entry - 用户的令牌条目。
		 * @param {object} decoded - 解码后的刷新令牌。
		 * @returns {boolean} 如果条目有效，则返回 true。
		 */
		validateEntry: (entry, decoded) => entry.deviceId === decoded.deviceId,
		mismatchRevokeReason: 'refresh-device-mismatch',
		/**
		 * 生成新的访问令牌。
		 * @param {object} payload - 访问令牌的有效载荷。
		 * @returns {Promise<string>} 新的访问令牌。
		 */
		generateAccessToken: (payload) => generateAccessToken(payload),
		/**
		 * 生成新的刷新令牌。
		 * @param {object} payload - 刷新令牌的有效载荷。
		 * @param {object} entry - 旧的令牌条目。
		 * @returns {Promise<string>} 新的刷新令牌。
		 */
		generateRefreshToken: (payload, entry) => generateRefreshToken(payload, entry.deviceId),
		/**
		 * 获取新的令牌条目。
		 * @param {object} decoded - 解码后的新刷新令牌。
		 * @param {object} oldEntry - 旧的令牌条目。
		 * @returns {object} 新的令牌条目。
		 */
		getNewTokenEntry: (decoded, oldEntry) => ({
			jti: decoded.jti,
			deviceId: oldEntry.deviceId,
			expiry: decoded.exp * 1000,
		}),
		accessTokenKey: 'accessToken',
		refreshTokenKey: 'refreshToken',
		errorI18nKey: 'fountConsole.auth.refreshTokenError',
	})
}

/**
 * 刷新 API 访问令牌。
 * @param {string} apiRefreshTokenValue - 客户端提供的 API 刷新令牌。
 * @param {import('npm:express').Request} req - Express 请求对象。
 * @returns {Promise<object>} 包含刷新结果的对象。
 */
async function refreshApiToken(apiRefreshTokenValue, req) {
	return handleTokenRefresh(apiRefreshTokenValue, req, {
		tokenName: 'API',
		expectedType: 'apiRefresh',
		userTokenArrayKey: 'apiRefreshTokens',
		/**
		 * 验证 API 令牌条目。
		 * @param {object} entry - 用户的 API 令牌条目。
		 * @param {object} decoded - 解码后的 API 刷新令牌。
		 * @returns {boolean} 如果条目有效，则返回 true。
		 */
		validateEntry: (entry, decoded) => entry.apiKeyJti === decoded.apiKeyJti,
		mismatchRevokeReason: 'api-refresh-key-mismatch',
		/**
		 * 生成新的 API 访问令牌。
		 * @param {object} payload - API 访问令牌的有效载荷。
		 * @returns {Promise<string>} 新的 API 访问令牌。
		 */
		generateAccessToken: (payload) => generateApiAccessToken(payload),
		/**
		 * 生成新的 API 刷新令牌。
		 * @param {object} payload - API 刷新令牌的有效载荷。
		 * @param {object} entry - 旧的令牌条目。
		 * @returns {Promise<string>} 新的 API 刷新令牌。
		 */
		generateRefreshToken: (payload, entry) => generateApiRefreshToken(payload, entry.apiKeyJti),
		/**
		 * 获取新的 API 令牌条目。
		 * @param {object} decoded - 解码后的新 API 刷新令牌。
		 * @param {object} oldEntry - 旧的令牌条目。
		 * @returns {object} 新的 API 令牌条目。
		 */
		getNewTokenEntry: (decoded, oldEntry) => ({
			jti: decoded.jti,
			apiKeyJti: oldEntry.apiKeyJti,
			expiry: decoded.exp * 1000,
		}),
		accessTokenKey: 'apiAccessToken',
		refreshTokenKey: 'apiRefreshToken',
		errorI18nKey: 'fountConsole.auth.apiRefreshTokenError',
	})
}


/**
 * 用户登出。
 * @param {import('npm:express').Request} req - Express 请求对象。
 * @param {import('npm:express').Response} res - Express 响应对象。
 * @returns {Promise<void>}
 */
export async function logout(req, res) {
	const { cookies: { accessToken, refreshToken } } = req
	const user = await getUserByReq(req)

	if (accessToken) await revokeToken(accessToken, 'access-logout')

	if (refreshToken && user) {
		const userConfig = getUserByUsername(user.username)
		if (userConfig?.auth?.refreshTokens) try {
			const decoded = jose.decodeJwt(refreshToken)
			if (decoded?.jti) {
				const tokenIndex = userConfig.auth.refreshTokens.findIndex(t => t.jti === decoded.jti)
				if (tokenIndex !== -1) userConfig.auth.refreshTokens.splice(tokenIndex, 1)
				await revokeToken(refreshToken, 'refresh-logout')
			}
		} catch (error) {
			console.errorI18n('fountConsole.auth.logoutRefreshTokenProcessError', { error: error.message })
		}
	}

	clearAuthCookies(res, getSecureCookieOptions(req))
	save_config()
	res.status(200).json({ success: true, message: 'Logout successful' })
}

/**
 * 验证 API 密钥。
 * @param {string} apiKey - 要验证的 API 密钥。
 * @returns {Promise<object|null>} 如果成功，则返回用户对象，否则返回 null。
 */
export async function verifyApiKey(apiKey) {
	try {
		const hash = crypto.createHash('sha256').update(apiKey).digest('hex')
		const keyInfo = config.data.apiKeys[hash]
		if (!keyInfo) return null

		const user = getUserByUsername(keyInfo.username)
		if (!user) {
			delete config.data.apiKeys[hash]
			save_config()
			return null
		}

		const userKeyInfo = user.auth.apiKeys.find(k => k.jti === keyInfo.jti)
		if (userKeyInfo) userKeyInfo.lastUsed = Date.now()

		return user
	} catch (error) {
		console.error('API key verification error:', error)
		return null
	}
}

/**
 * 尝试对请求进行身份验证，成功则填充 req.user。
 * @param {import('npm:express').Request} req - Express 请求对象。
 * @param {import('npm:express').Response} res - Express 响应对象。
 * @throws {Error} 如果认证失败。
 * @returns {Promise<void>}
 */
export async function try_auth_request(req, res) {
	if (req.user) return

	/**
	 * 抛出未授权错误。
	 * @param {string} [message='Unauthorized'] - 错误消息。
	 * @throws {Error}
	 */
	const Unauthorized = (message = 'Unauthorized') => {
		console.error(message)
		throw new Error(message)
	}

	// 1. API 密钥认证
	let apiKey
	if (req.ws) apiKey = req.headers['sec-websocket-protocol']?.split?.(',')?.[0]?.trim?.()
	else {
		const authHeader = req.headers.authorization
		if (authHeader?.startsWith?.('Bearer ')) apiKey = authHeader.substring(7)
	}
	apiKey ||= req.query?.['fount-apikey']
	if (apiKey) {
		const user = await verifyApiKey(apiKey)
		if (user) { req.user = user; return }
		return Unauthorized('Invalid API Key')
	}

	// 2. Cookie 令牌认证
	const { accessToken, refreshToken, apiAccessToken, apiRefreshToken } = req.cookies
	let decoded = accessToken ? await verifyToken(accessToken) : null
	if (decoded && decoded.type !== 'api') {
		req.user = config.data.users[decoded.username]
		return
	}

	decoded = apiAccessToken ? await verifyToken(apiAccessToken) : null
	if (decoded && decoded.type === 'api') {
		req.user = config.data.users[decoded.username]
		return
	}

	// 3. 尝试刷新令牌
	let refreshResult
	if (refreshToken) refreshResult = await refresh(refreshToken, req)
	else if (apiRefreshToken) refreshResult = await refreshApiToken(apiRefreshToken, req)

	if (!refreshResult || !refreshResult.success) {
		clearAuthCookies(res, getSecureCookieOptions(req))
		return Unauthorized(refreshResult?.message || 'Session expired, please login again.')
	}

	// 4. 刷新成功，设置 Cookies 并验证新令牌
	const cookieOptions = getSecureCookieOptions(req)
	let newAccessTokenValue
	if (refreshResult.accessToken) {
		res.cookie('accessToken', refreshResult.accessToken, { ...cookieOptions, maxAge: ACCESS_TOKEN_EXPIRY_DURATION })
		res.cookie('refreshToken', refreshResult.refreshToken, { ...cookieOptions, maxAge: REFRESH_TOKEN_EXPIRY_DURATION })
		req.cookies.accessToken = refreshResult.accessToken // 为后续中间件更新 req
		newAccessTokenValue = refreshResult.accessToken
	} else if (refreshResult.apiAccessToken) {
		res.cookie('apiAccessToken', refreshResult.apiAccessToken, { ...cookieOptions, maxAge: ACCESS_TOKEN_EXPIRY_DURATION })
		res.cookie('apiRefreshToken', refreshResult.apiRefreshToken, { ...cookieOptions, maxAge: REFRESH_TOKEN_EXPIRY_DURATION })
		req.cookies.apiAccessToken = refreshResult.apiAccessToken
		newAccessTokenValue = refreshResult.apiAccessToken
	}

	const newDecodedToken = await verifyToken(newAccessTokenValue)
	if (!newDecodedToken) return Unauthorized('Failed to verify newly refreshed token.')

	req.user = config.data.users[newDecodedToken.username]
}

/**
 * try_auth_request 的 Promise 包装器。
 * @param {import('npm:express').Request} req - Express 请求对象。
 * @param {import('npm:express').Response} res - Express 响应对象。
 * @returns {Promise<boolean>} 成功时为 true，失败时为 false。
 */
export function auth_request(req, res) {
	return try_auth_request(req, res).then(() => true, () => false)
}

/**
 * 认证中间件。
 * @param {import('npm:express').Request} req - Express 请求对象。
 * @param {import('npm:express').Response} res - Express 响应对象。
 * @param {import('npm:express').NextFunction} next - Express 的 next 中间件函数。
 * @returns {Promise<void>}
 */
export async function authenticate(req, res, next) {
	/**
	 * 处理未授权的请求。
	 * @param {string} [message='Unauthorized'] - 错误消息。
	 * @returns {void}
	 */
	const Unauthorized = (message = 'Unauthorized') => {
		const path = encodeURIComponent(req.originalUrl)
		if (req.accepts('html') && req.method === 'GET')
			return res.redirect(`/login?redirect=${path}`)

		return res.status(401).json({ success: false, message })
	}

	try {
		await try_auth_request(req, res)
		next?.()
	}
	catch (error) {
		return Unauthorized(error.message)
	}
}

/**
 * 通过将其 JTI 添加到撤销列表来撤销令牌。
 * @param {string} token - 要撤销的令牌。
 * @param {string} [typeSuffix='unknown'] - 撤销原因的后缀 (例如, 'logout', 'manual')。
 * @returns {Promise<void>}
 */
async function revokeToken(token, typeSuffix = 'unknown') {
	try {
		const decoded = jose.decodeJwt(token)
		if (!decoded || !decoded.jti)
			return console.errorI18n('fountConsole.auth.revokeTokenNoJTI')

		let tokenType = decoded.type || 'unknown'
		if (tokenType === 'unknown' && decoded.exp && decoded.iat) {
			const duration = (decoded.exp - decoded.iat) * 1000
			if (Math.abs(duration - ACCESS_TOKEN_EXPIRY_DURATION) < ms('5m')) tokenType = 'access'
			else if (Math.abs(duration - REFRESH_TOKEN_EXPIRY_DURATION) < ms('1h')) tokenType = 'refresh'
		}

		config.data.revokedTokens[decoded.jti] = {
			expiry: decoded.exp ? decoded.exp * 1000 : Date.now() + REFRESH_TOKEN_EXPIRY_DURATION,
			type: `${tokenType}-${typeSuffix}`,
			revokedAt: Date.now(),
		}
		save_config()
	} catch (e) {
		console.error(`Error decoding token for revocation: ${e.message}`)
	}
}

// --- 用户管理 ---

/**
 * 通过用户名获取完整的用户信息对象。
 * @param {string} username - 用户名。
 * @returns {object|undefined} 用户对象，如果未找到则为 undefined。
 */
export function getUserByUsername(username) {
	return config.data.users[username]
}

/**
 * 获取所有用户名的列表。
 * @returns {string[]} 用户名数组。
 */
export function getAllUserNames() {
	return Object.keys(config.data.users)
}

/**
 * 获取所有用户对象的字典。
 * @returns {object} 用户对象的字典。
 */
export function getAllUsers() {
	return config.data.users
}

/**
 * 创建一个新用户。
 * @param {string} username - 用户名。
 * @param {string} password - 密码。
 * @returns {Promise<object>} 创建的用户对象。
 */
async function createUser(username, password) {
	const hashedPassword = await hashPassword(password)
	const userId = crypto.randomUUID()
	const now = Date.now()
	config.data.users[username] = {
		username,
		createdAt: now,
		auth: {
			userId,
			password: hashedPassword,
			loginAttempts: 0,
			lockedUntil: null,
			refreshTokens: [],
			apiKeys: [],
			apiRefreshTokens: [],
		},
		...loadJsonFile(path.join(__dirname, 'default', 'templates', 'user.json')),
	}

	save_config()
	return config.data.users[username]
}

/**
 * 使用 Argon2id 哈希密码。
 * @param {string} password - 明文密码。
 * @returns {Promise<string>} 哈希后的密码。
 */
export async function hashPassword(password) {
	return await hash(password, { algorithm: Algorithm.Argon2id })
}

/**
 * 验证密码。
 * @param {string} password - 用户提供的明文密码。
 * @param {string} hashedPassword - 存储的哈希密码。
 * @returns {Promise<boolean>} 如果密码匹配则为 true，否则为 false。
 */
export async function verifyPassword(password, hashedPassword) {
	if (!password || !hashedPassword) return false
	return await verify(hashedPassword, password)
}

/**
 * 更改用户密码。
 * @param {string} username - 用户名。
 * @param {string} currentPassword - 当前密码。
 * @param {string} newPassword - 新密码。
 * @returns {Promise<{success: boolean, message: string}>} 操作结果。
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
 * 生成 API 密钥。
 * @param {string} username - 与密钥关联的用户名。
 * @param {string} [description='New API Key'] - API 密钥的描述。
 * @returns {Promise<{apiKey: string, jti: string}>} 生成的 API 密钥及其 JTI。
 */
export async function generateApiKey(username, description = 'New API Key') {
	const user = getUserByUsername(username)
	if (!user) throw new Error('User not found')

	const apiKey = `${crypto.randomBytes(32).toString('base64url')}`
	const hash = crypto.createHash('sha256').update(apiKey).digest('hex')
	const jti = crypto.randomUUID()

	config.data.apiKeys[hash] = { username, jti }
	user.auth.apiKeys.push({
		jti,
		description,
		createdAt: Date.now(),
		lastUsed: null,
		prefix: apiKey.substring(0, 7),
	})
	save_config()
	return { apiKey, jti }
}

/**
 * 撤销 API 密钥。
 * @param {string} username - 用户名。
 * @param {string} jti - 要撤销的 API 密钥的 JTI。
 * @param {string} password - 用于验证的用户密码。
 * @returns {Promise<{success: boolean, message: string}>} 操作结果。
 */
export async function revokeApiKey(username, jti, password) {
	const user = getUserByUsername(username)
	if (!user?.auth?.apiKeys) return { success: false, message: 'User or API keys not found' }

	if (!await verifyPassword(password, user.auth.password))
		return { success: false, message: 'Invalid password for revoking API key' }

	const keyIndex = user.auth.apiKeys.findIndex(key => key.jti === jti)
	if (keyIndex === -1) return { success: false, message: 'API key not found for this user' }

	const hashToRemove = Object.keys(config.data.apiKeys).find(hash => config.data.apiKeys[hash].jti === jti)
	if (hashToRemove) delete config.data.apiKeys[hashToRemove]
	user.auth.apiKeys.splice(keyIndex, 1)

	// 撤销关联的 API 刷新令牌
	const tokensToRevoke = user.auth.apiRefreshTokens.filter(token => token.apiKeyJti === jti)
	for (const token of tokensToRevoke)
		config.data.revokedTokens[token.jti] = {
			expiry: token.expiry,
			type: 'api-refresh-revoked-by-apikey',
			revokedAt: Date.now(),
		}

	user.auth.apiRefreshTokens = user.auth.apiRefreshTokens.filter(token => token.apiKeyJti !== jti)

	save_config()
	return { success: true, message: 'API key revoked successfully' }
}

/**
 * 通过 JTI 撤销用户的设备（刷新令牌）。
 * @param {string} username - 用户名。
 * @param {string} tokenJti - 要撤销的刷新令牌的 JTI。
 * @param {string} password - 用于验证的用户密码。
 * @returns {Promise<{success: boolean, message: string}>} 操作结果。
 */
export async function revokeUserDeviceByJti(username, tokenJti, password) {
	const user = getUserByUsername(username)
	if (!user?.auth?.refreshTokens) return { success: false, message: 'User or device list not found' }

	if (!await verifyPassword(password, user.auth.password))
		return { success: false, message: 'Invalid password for user action' }

	const tokenIndex = user.auth.refreshTokens.findIndex(token => token.jti === tokenJti)
	if (tokenIndex === -1) return { success: false, message: 'Device (JTI) not found for this user' }

	const revokedToken = user.auth.refreshTokens.splice(tokenIndex, 1)[0]
	if (revokedToken?.jti)
		config.data.revokedTokens[revokedToken.jti] = {
			expiry: revokedToken.expiry,
			type: 'refresh-revoked-by-user-jti',
			revokedAt: Date.now(),
		}

	save_config()
	return { success: true, message: 'Device access (JTI) revoked successfully' }
}

/**
 * 删除用户帐户及其数据，需要密码验证。
 * @param {string} username - 要删除的帐户的用户名。
 * @param {string} password - 用户密码。
 * @returns {Promise<{success: boolean, message: string}>} 操作结果。
 */
export async function deleteUserAccount(username, password) {
	const user = getUserByUsername(username)
	if (!user?.auth) return { success: false, message: 'User not found.' }
	if (!await verifyPassword(password, user.auth.password))
		return { success: false, message: 'Invalid password for deleting account.' }

	await events.emit('BeforeUserDeleted', { username })

	const userDirectoryPath = getUserDictionary(username)

	// 撤销所有用户刷新令牌
	user.auth.refreshTokens?.forEach(token => {
		if (token.jti)
			config.data.revokedTokens[token.jti] = {
				expiry: token.expiry,
				type: 'refresh-revoked-account-delete',
				revokedAt: Date.now(),
			}
	})

	delete config.data.users[username]
	save_config()

	if (fs.existsSync(userDirectoryPath))
		fs.rmSync(userDirectoryPath, { recursive: true, force: true })

	await events.emit('AfterUserDeleted', { username })
	return { success: true, message: 'User account deleted successfully.' }
}

/**
 * 重命名用户帐户，需要密码验证。
 * @param {string} currentUsername - 当前用户名。
 * @param {string} newUsername - 新用户名。
 * @param {string} password - 用户密码。
 * @returns {Promise<{success: boolean, message: string}>} 操作结果。
 */
export async function renameUser(currentUsername, newUsername, password) {
	const user = getUserByUsername(currentUsername)
	if (!user?.auth) return { success: false, message: 'Current user not found.' }
	if (!await verifyPassword(password, user.auth.password))
		return { success: false, message: 'Invalid password for renaming user.' }

	if (currentUsername === newUsername)
		return { success: false, message: 'New username must be different from the current one.' }

	if (getUserByUsername(newUsername))
		return { success: false, message: 'New username already exists.' }

	await events.emit('BeforeUserRenamed', { oldUsername: currentUsername, newUsername })

	const oldUserPath = getUserDictionary(currentUsername)
	const newUserConfigEntry = JSON.parse(JSON.stringify(user))
	newUserConfigEntry.username = newUsername
	config.data.users[newUsername] = newUserConfigEntry
	delete config.data.users[currentUsername]

	const newUserPath = getUserDictionary(newUsername)

	try {
		if (fse.existsSync(oldUserPath) && oldUserPath.toLowerCase() !== newUserPath.toLowerCase()) {
			fse.ensureDirSync(path.dirname(newUserPath))
			fse.moveSync(oldUserPath, newUserPath, { overwrite: true })
		}
	}
	catch (error) {
		// 失败时恢复配置更改
		config.data.users[currentUsername] = user
		delete config.data.users[newUsername]
		console.error('Error moving user data directory:', error)
		return { success: false, message: `Error moving user data: ${error.message}. Username change reverted.` }
	}

	save_config()
	await events.emit('AfterUserRenamed', { oldUsername: currentUsername, newUsername })
	return { success: true, message: 'Username renamed successfully.' }
}

/**
 * 从请求中获取用户信息。依赖于 authenticate 中间件已填充 req.user。
 * @param {import('npm:express').Request} req - Express 请求对象。
 * @returns {Promise<object>} 用户对象。
 * @throws {Error} 如果请求未经过身份验证。
 */
export async function getUserByReq(req) {
	if (!req.user) throw new Error('Request is not authenticated. Use authenticate middleware first.')
	return req.user
}

/**
 * 获取用户数据目录的路径。
 * @param {string} username - 用户名。
 * @returns {string} 用户数据目录的绝对路径。
 */
export function getUserDictionary(username) {
	const user = config.data.users[username]
	return path.resolve(user?.UserDictionary || path.join(data_path, 'users', username))
}

let avgVerifyTime = 0
{
	const startTime = Date.now()
	await verify('$argon2id$v=19$m=65536,t=3,p=4$ZHVtbXlkYXRh$ZHVtbXlkYXRhZGF0YQ', 'dummydata').catch(() => { })
	avgVerifyTime = Date.now() - startTime
}

/**
 * 用户登录。
 * @param {string} username - 用户名。
 * @param {string} password - 密码。
 * @param {string} [deviceId='unknown'] - 设备标识符。
 * @param {import('npm:express').Request} req - Express 请求对象。
 * @returns {Promise<object>} 包含状态码、消息和令牌的对象。
 */
export async function login(username, password, deviceId = 'unknown', req) {
	const { ip } = req
	const user = getUserByUsername(username)

	/**
	 * 处理失败的登录尝试。
	 * @param {object} [response={}] - 要包含在响应中的附加数据。
	 * @returns {Promise<object>} 包含状态码和消息的响应对象。
	 */
	async function handleFailedLogin(response = {}) {
		loginFailures[ip] = (loginFailures[ip] || 0) + 1

		if (loginFailures[ip] >= BRUTE_FORCE_THRESHOLD && Math.random() < BRUTE_FORCE_FAKE_SUCCESS_RATE) {
			const fakePrivateKey = await getFakePrivateKey()
			const fakeUserId = crypto.randomUUID()
			const accessToken = await generateAccessToken({ username, userId: fakeUserId }, fakePrivateKey)
			const refreshToken = await generateRefreshToken({ username, userId: fakeUserId }, deviceId, fakePrivateKey)
			return { status: 200, success: true, message: 'Login successful', accessToken, refreshToken }
		}
		// 时间攻击保护
		const delay = Math.max(0, avgVerifyTime * 0.9 + Math.random() * avgVerifyTime * 0.2)
		await new Promise(resolve => setTimeout(resolve, delay).unref())
		return { status: 401, success: false, message: 'Invalid username or password', ...response }
	}

	if (!user) return await handleFailedLogin()

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
			authData.loginAttempts = 0
			save_config()
			console.logI18n('fountConsole.auth.accountLockedLog', { username })
			return { status: 403, success: false, message: 'Account locked due to too many failed attempts.' }
		}
		return await handleFailedLogin()
	}

	// 登录成功
	delete loginFailures[ip]
	authData.loginAttempts = 0
	authData.lockedUntil = null

	// 创建用户目录
	const userdir = getUserDictionary(username)
	if (!fs.existsSync(userdir)) try {
		fse.copySync(path.join(__dirname, '/default/templates/user'), userdir, { overwrite: false })
	} catch (e) {
		console.error(`Failed to copy default user template for ${username}`, e)
	}

	for (const subdir of ['settings']) try {
		fs.mkdirSync(path.join(userdir, subdir), { recursive: true })
	} catch (e) {
		console.error(`Failed to create user subdirectory: ${subdir}`, e)
	}

	const payload = { username: user.username, userId: authData.userId }
	const accessToken = await generateAccessToken(payload)
	const refreshToken = await generateRefreshToken(payload, deviceId)
	const decodedRefreshToken = jose.decodeJwt(refreshToken)

	authData.refreshTokens = authData.refreshTokens.filter(t => t.deviceId !== deviceId)
	authData.refreshTokens.push({
		jti: decodedRefreshToken.jti,
		deviceId,
		expiry: decodedRefreshToken.exp * 1000,
		ipAddress: req?.ip,
		userAgent: req?.headers?.['user-agent'],
		lastSeen: Date.now(),
	})
	save_config()

	return { status: 200, success: true, message: 'Login successful', accessToken, refreshToken }
}


/**
 * 注册一个新用户。
 * @param {string} username - 用户名。
 * @param {string} password - 密码。
 * @returns {Promise<object>} 包含状态码和用户信息的对象。
 */
export async function register(username, password) {
	if (getUserByUsername(username)?.auth) return { status: 409, success: false, message: 'Username already exists' }
	const newUser = await createUser(username, password)
	return { status: 201, success: true, user: { username: newUser.username, userId: newUser.auth.userId, createdAt: newUser.createdAt } }
}

/**
 * 使用 API 密钥设置认证 Cookies。
 * @param {string} apiKey - API 密钥。
 * @param {import('npm:express').Request} req - Express 请求对象。
 * @param {import('npm:express').Response} res - Express 响应对象。
 * @returns {Promise<object>} 操作结果。
 */
export async function setApiCookieResponse(apiKey, req, res) {
	if (!apiKey) return { status: 400, success: false, error: 'API key is required.' }

	const user = await verifyApiKey(apiKey)
	if (!user) return { status: 401, success: false, error: 'Invalid API key.' }

	const hash = crypto.createHash('sha256').update(apiKey).digest('hex')
	const apiKeyInfo = config.data.apiKeys[hash]
	if (!apiKeyInfo) return { status: 500, success: false, error: 'API key data inconsistency.' }

	const payload = { username: user.username, userId: user.auth.userId }
	const apiAccessToken = await generateApiAccessToken(payload)
	const apiRefreshToken = await generateApiRefreshToken(payload, apiKeyInfo.jti)
	const decodedApiRefreshToken = jose.decodeJwt(apiRefreshToken)

	user.auth.apiRefreshTokens = user.auth.apiRefreshTokens.filter(t => t.apiKeyJti !== apiKeyInfo.jti)
	user.auth.apiRefreshTokens.push({
		jti: decodedApiRefreshToken.jti,
		apiKeyJti: apiKeyInfo.jti,
		expiry: decodedApiRefreshToken.exp * 1000,
		ipAddress: req?.ip,
		userAgent: req?.headers?.['user-agent'],
		lastSeen: Date.now(),
	})

	const cookieOptions = getSecureCookieOptions(req)
	res.cookie('apiAccessToken', apiAccessToken, { ...cookieOptions, maxAge: ACCESS_TOKEN_EXPIRY_DURATION })
	res.cookie('apiRefreshToken', apiRefreshToken, { ...cookieOptions, maxAge: REFRESH_TOKEN_EXPIRY_DURATION })

	return { status: 200, success: true, message: 'API cookie set successfully.' }
}


// --- 定时清理任务 ---

/**
 * 清理过期的已撤销令牌。
 * @returns {void}
 */
function cleanupRevokedTokens() {
	const now = Date.now()
	let changed = false
	for (const jti in config.data.revokedTokens)
		if (config.data.revokedTokens[jti].expiry <= now) {
			delete config.data.revokedTokens[jti]
			changed = true
		}

	if (changed) save_config()
}

/**
 * 清理用户配置中过期的刷新令牌。
 * @returns {void}
 */
function cleanupRefreshTokens() {
	const now = Date.now()
	let changed = false
	for (const username in config.data.users) {
		const user = config.data.users[username]
		if (user?.auth?.refreshTokens) {
			const originalCount = user.auth.refreshTokens.length
			user.auth.refreshTokens = user.auth.refreshTokens.filter(
				token => token.expiry > now && !config.data.revokedTokens[token.jti]
			)
			if (user.auth.refreshTokens.length !== originalCount) changed = true
		}
	}
	if (changed) save_config()
}

/**
 * 清理旧的登录失败记录。
 * @returns {void}
 */
function cleanupLoginFailures() {
	for (const ip in loginFailures)
		if (loginFailures[ip] < MAX_LOGIN_ATTEMPTS) delete loginFailures[ip]
		else loginFailures[ip] -= MAX_LOGIN_ATTEMPTS
}

// 设置定时任务
setInterval(() => {
	cleanupRevokedTokens()
	cleanupRefreshTokens()
	cleanupLoginFailures()
}, ms('1h')).unref()
