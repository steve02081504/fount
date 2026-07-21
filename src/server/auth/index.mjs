import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { setInterval, setTimeout } from 'node:timers'

import fse from 'npm:fs-extra'
import * as jose from 'npm:jose'

import { httpError } from '../../scripts/http_error.mjs'
import { console } from '../../scripts/i18n/bare.mjs'
import { loadJsonFile } from '../../scripts/json_loader.mjs'
import { ms, msstr } from '../../scripts/ms.mjs'
import { __dirname } from '../base.mjs'
import { events } from '../events.mjs'
import { config, save_config, data_path } from '../server.mjs'

let hash, verify, Algorithm
const argon2Loaded = import('npm:@node-rs/argon2').catch(async error => {
	globalThis.console.warn(error)
	const fallback = await import('npm:argon2')
	return {
		hash: fallback.hash,
		verify: fallback.verify,
		Algorithm: {
			Argon2id: fallback.argon2id
		}
	}
}).then(mod => {
	hash = mod.hash
	verify = mod.verify
	Algorithm = mod.Algorithm
})
/**
 * 此文件处理应用程序的所有认证相关逻辑，
 * 包括用户注册、登录、JWT管理、API密钥验证和密码处理。
 */

// --- 常量定义 ---
const ACCESS_TOKEN_EXPIRY = '1d'
/**
 * 访问令牌的持续时间（毫秒）。
 * @constant {number}
 */
export const ACCESS_TOKEN_EXPIRY_DURATION = ms(ACCESS_TOKEN_EXPIRY)
/**
 * 刷新令牌的过期时间字符串。
 * @constant {string}
 */
export const REFRESH_TOKEN_EXPIRY = '30d'
/**
 * 刷新令牌的持续时间（毫秒）。
 * @constant {number}
 */
export const REFRESH_TOKEN_EXPIRY_DURATION = ms(REFRESH_TOKEN_EXPIRY)
const ACCOUNT_LOCK_TIME = '10m'
const MAX_LOGIN_ATTEMPTS = 5
const BRUTE_FORCE_THRESHOLD = 8
const BRUTE_FORCE_FAKE_SUCCESS_RATE = 1 / 3
const JWT_CACHE_SIZE = 32

// --- 模块级变量 ---

/**
 * JWT 签名私钥。
 * @type {jose.KeyLike}
 */
let privateKey
/**
 * JWT 验签公钥。
 * @type {jose.KeyLike}
 */
let publicKey
/**
 * 各用户登录失败次数记录。
 * @type {Object<string, number>}
 */
const loginFailures = {}
/**
 * 已解析 JWT 的 LRU 缓存。
 * @type {Map<string, object>}
 */
const jwtCache = new Map()
/**
 * 刷新令牌 single-flight：同一旧 refreshToken 的并发/迟到请求复用同一结果。
 * 成功后保留约 1 分钟宽限，避免 Set-Cookie 生效前的迟到请求踩到已轮换的 jti。
 * @type {Map<string, Promise<object>>}
 */
const refreshInFlight = new Map()
const REFRESH_GRACE_MS = ms('1m')

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
 * 认证变更失败时抛出 HttpError。
 * @param {number} status HTTP 状态码
 * @param {Record<string, unknown>} json 响应 JSON（通常含 `i18nKey`）
 * @returns {never} 始终抛出 HttpError，不会返回。
 */
export function authMutationFail(status, json) {
	const message = String(json.i18nKey ?? json.message ?? json.error ?? `HTTP ${status}`)
	throw httpError(status, message, { json })
}

/**
 * 发送 `{ status, ...fields }` 形态的业务结果（不含 `success`）。
 * @param {import('npm:express').Response} res Express 响应
 * @param {{ status: number } & Record<string, unknown>} result 业务结果
 * @returns {void}
 */
export function respondAuthResult(res, result) {
	const { status = 200, success, ...json } = result
	res.status(status).json(json)
}

/**
 * 清除所有认证相关的 Cookies。
 * @param {import('npm:express').Response} res - Express 响应对象。
 * @param {object} options - Cookie 选项。
 */
function clearAuthCookies(res, options) {
	res.clearCookie('accessToken', options)
	res.clearCookie('refreshToken', options)
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
			config.data.users[user].auth.webauthnCredentials ??= []
		}

	cleanupRevokedTokens()
	cleanupRefreshTokens()

	// 设置定时任务
	setInterval(() => {
		cleanupRevokedTokens()
		cleanupRefreshTokens()
		cleanupLoginFailures()
	}, ms('1h')).unref()
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
			return { status: 401, message: `Invalid or revoked ${options.tokenName} refresh token` }

		const user = getUserByUsername(decoded.username)
		if (!user || !user.auth || !user.auth[options.userTokenArrayKey])
			return { status: 401, message: `User not found or ${options.tokenName} refresh tokens unavailable` }

		const tokenEntry = user.auth[options.userTokenArrayKey].find(t => t.jti === decoded.jti)

		if (!tokenEntry || !options.validateEntry(tokenEntry, decoded)) {
			if (tokenEntry) await revokeToken(refreshTokenValue, options.mismatchRevokeReason)
			return { status: 401, message: `${options.tokenName} refresh token not found or validation mismatch` }
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
		save_config()

		return {
			status: 200,
			[options.accessTokenKey]: newAccessToken,
			[options.refreshTokenKey]: newRefreshToken,
		}
	} catch (error) {
		console.errorI18n(options.errorI18nKey, { error: error.message })
		return { status: 401, message: `Error refreshing ${options.tokenName} token` }
	}
}

/**
 * 刷新访问令牌（同一旧 refreshToken 并发/迟到请求 single-flight + 宽限复用）。
 * @param {string} refreshTokenValue - 客户端提供的刷新令牌。
 * @param {import('npm:express').Request} req - Express 请求对象。
 * @returns {Promise<object>} 包含刷新结果的对象。
 */
async function refresh(refreshTokenValue, req) {
	const existing = refreshInFlight.get(refreshTokenValue)
	if (existing) return existing

	const promise = handleTokenRefresh(refreshTokenValue, req, {
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
	}).then(result => {
		if (result.status === 200) setTimeout(() => {
			if (refreshInFlight.get(refreshTokenValue) === promise)
				refreshInFlight.delete(refreshTokenValue)
		}, REFRESH_GRACE_MS).unref()
		else refreshInFlight.delete(refreshTokenValue)
		return result
	}, error => {
		refreshInFlight.delete(refreshTokenValue)
		throw error
	})

	refreshInFlight.set(refreshTokenValue, promise)
	return promise
}

/**
 * 用户登出。
 * @param {import('npm:express').Request} req - Express 请求对象。
 * @param {import('npm:express').Response} res - Express 响应对象。
 * @returns {Promise<void>}
 */
export async function logout(req, res) {
	const { cookies: { accessToken, refreshToken } } = req
	const user = getUserByReq(req)

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
	res.status(200).json({})
}

/**
 * 计算 API 密钥的 SHA-256 哈希（`config.data.apiKeys` 的键）。
 * @param {string} apiKey - API 密钥明文。
 * @returns {string} 十六进制哈希。
 */
function hashApiKey(apiKey) {
	return crypto.createHash('sha256').update(apiKey).digest('hex')
}

/**
 * 验证 API 密钥。
 * @param {string} apiKey - 要验证的 API 密钥。
 * @returns {Promise<object|null>} 如果成功，则返回用户对象，否则返回 null。
 */
export async function verifyApiKey(apiKey) {
	try {
		const hash = hashApiKey(apiKey)
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
 * 按序尝试：API Key（WebSocket 子协议 / Bearer / 查询 `fount-apikey` / Cookie `fount-apikey`）→
 * Cookie `accessToken` → 用 Cookie `refreshToken` 刷新会话。
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
	apiKey ||= req.cookies?.['fount-apikey']
	if (apiKey) {
		const user = await verifyApiKey(apiKey)
		if (user) { req.user = user; return }
		return Unauthorized('Invalid API Key: ' + apiKey)
	}

	// 2. Cookie 令牌认证
	const { accessToken = undefined, refreshToken = undefined } = req.cookies
	const decoded = accessToken ? await verifyToken(accessToken) : null
	if (decoded) {
		req.user = config.data.users[decoded.username]
		return
	}

	// 3. 尝试刷新令牌
	if (!refreshToken) {
		clearAuthCookies(res, getSecureCookieOptions(req))
		return Unauthorized('Session expired, please login again.')
	}

	const refreshResult = await refresh(refreshToken, req)
	if (refreshResult.status !== 200) {
		clearAuthCookies(res, getSecureCookieOptions(req))
		return Unauthorized(refreshResult.message || 'Session expired, please login again.')
	}

	// 4. 刷新成功，设置 Cookies 并验证新令牌
	const cookieOptions = getSecureCookieOptions(req)
	res.cookie('accessToken', refreshResult.accessToken, { ...cookieOptions, maxAge: ACCESS_TOKEN_EXPIRY_DURATION })
	res.cookie('refreshToken', refreshResult.refreshToken, { ...cookieOptions, maxAge: REFRESH_TOKEN_EXPIRY_DURATION })
	req.cookies.accessToken = refreshResult.accessToken

	const newDecodedToken = await verifyToken(refreshResult.accessToken)
	if (!newDecodedToken) return Unauthorized('Failed to verify newly refreshed token.')

	req.user = config.data.users[newDecodedToken.username]
}

/**
 * 未授权响应：与 `authenticate` 一致——GET 且接受 HTML 时重定向登录，否则 401 JSON。
 * @param {import('npm:express').Request} req - Express 请求对象。
 * @param {import('npm:express').Response} res - Express 响应对象。
 * @param {string} [message='Unauthorized'] - 错误消息。
 * @returns {import('npm:express').Response} 已发送的重定向或 JSON 响应
 */
export function respondUnauthorized(req, res, message = 'Unauthorized') {
	const path = encodeURIComponent(req.originalUrl)
	if (req.accepts('html') && req.method === 'GET')
		return res.redirect(`/login?redirect=${path}`)
	return res.status(401).json({ message })
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
	try {
		await try_auth_request(req, res)
		next?.()
	}
	catch (error) {
		return respondUnauthorized(req, res, error.message)
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
			webauthnCredentials: [],
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
	if (!hash) await argon2Loaded
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
	if (!verify) await argon2Loaded
	return await verify(hashedPassword, password)
}

/**
 * 更改用户密码。
 * @param {string} username - 用户名。
 * @param {string} currentPassword - 当前密码。
 * @param {string} newPassword - 新密码。
 * @returns {Promise<void>}
 */
export async function changeUserPassword(username, currentPassword, newPassword) {
	const user = getUserByUsername(username)
	if (!user || !user.auth)
		authMutationFail(400, { i18nKey: 'userSettings.errors.accountNotFound' })

	const isValidPassword = await verifyPassword(currentPassword, user.auth.password)
	if (!isValidPassword)
		authMutationFail(401, { i18nKey: 'userSettings.changePassword.invalidCurrent' })

	user.auth.password = await hashPassword(newPassword)
	save_config()
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
	const hash = hashApiKey(apiKey)
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
 * 从全局索引与用户列表中删除指定 hash 的 API Key 记录。
 * @param {string} hash - `config.data.apiKeys` 中的 SHA-256 键。
 * @returns {boolean} 是否删除了记录。
 */
function deleteApiKeyHash(hash) {
	const keyInfo = config.data.apiKeys[hash]
	if (!keyInfo) return false

	const { username, jti } = keyInfo
	delete config.data.apiKeys[hash]

	const user = getUserByUsername(username)
	const keyIndex = user?.auth?.apiKeys?.findIndex(key => key.jti === jti) ?? -1
	if (keyIndex !== -1) user.auth.apiKeys.splice(keyIndex, 1)

	save_config()
	return true
}

/**
 * 按明文 API Key 撤销（调用方负责鉴权；无 key 时入口可用 jti 查 hash 后调 deleteApiKeyHash）。
 * @param {string} apiKey - API 密钥明文。
 * @returns {void}
 * @throws {import('../../scripts/http_error.mjs').HttpError} 密钥不存在时。
 */
export function revokeApiKey(apiKey) {
	if (!apiKey) return

	if (!deleteApiKeyHash(hashApiKey(apiKey)))
		authMutationFail(400, { i18nKey: 'userSettings.apiKeys.keyNotFound' })
}

/**
 * 按 JTI 撤销 API 密钥（设置页列表等无明文 key 的场景；调用方须已校验归属）。
 * @param {string} username - 密钥所有者用户名。
 * @param {string} jti - API 密钥 JTI。
 * @returns {void}
 * @throws {import('../../scripts/http_error.mjs').HttpError} 密钥不存在时。
 */
export function revokeApiKeyByJti(username, jti) {
	const hash = Object.keys(config.data.apiKeys).find(h =>
		config.data.apiKeys[h].jti === jti && config.data.apiKeys[h].username === username,
	)
	if (!hash)
		authMutationFail(400, { i18nKey: 'userSettings.apiKeys.keyNotFound' })
	deleteApiKeyHash(hash)
}

/**
 * 通过 JTI 撤销用户的设备（刷新令牌）。
 * @param {string} username - 用户名。
 * @param {string} tokenJti - 要撤销的刷新令牌的 JTI。
 * @param {string} password - 用于验证的用户密码。
 * @returns {Promise<void>}
 */
export async function revokeUserDeviceByJti(username, tokenJti, password) {
	const user = getUserByUsername(username)
	if (!user?.auth?.refreshTokens)
		authMutationFail(400, { i18nKey: 'userSettings.userDevices.listNotFound' })

	if (!await verifyPassword(password, user.auth.password))
		authMutationFail(401, { i18nKey: 'userSettings.userDevices.revokeWrongPassword' })

	const tokenIndex = user.auth.refreshTokens.findIndex(token => token.jti === tokenJti)
	if (tokenIndex === -1)
		authMutationFail(400, { i18nKey: 'userSettings.userDevices.deviceNotFound' })

	const revokedToken = user.auth.refreshTokens.splice(tokenIndex, 1)[0]
	if (revokedToken?.jti)
		config.data.revokedTokens[revokedToken.jti] = {
			expiry: revokedToken.expiry,
			type: 'refresh-revoked-by-user-jti',
			revokedAt: Date.now(),
		}

	save_config()
}

/**
 * 删除用户帐户及其数据，需要密码验证。
 * @param {string} username - 要删除的帐户的用户名。
 * @param {string} password - 用户密码。
 * @returns {Promise<void>}
 */
export async function deleteUserAccount(username, password) {
	const user = getUserByUsername(username)
	if (!user?.auth)
		authMutationFail(400, { i18nKey: 'userSettings.errors.accountNotFound' })
	if (!await verifyPassword(password, user.auth.password))
		authMutationFail(401, { i18nKey: 'userSettings.deleteAccount.wrongPassword' })

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
}

/**
 * 重命名用户帐户，需要密码验证。
 * @param {string} currentUsername - 当前用户名。
 * @param {string} newUsername - 新用户名。
 * @param {string} password - 用户密码。
 * @returns {Promise<void>}
 */
export async function renameUser(currentUsername, newUsername, password) {
	const user = getUserByUsername(currentUsername)
	if (!user?.auth)
		authMutationFail(400, { i18nKey: 'userSettings.errors.accountNotFound' })
	if (!await verifyPassword(password, user.auth.password))
		authMutationFail(401, { i18nKey: 'userSettings.renameUser.wrongPassword' })

	if (currentUsername === newUsername)
		authMutationFail(400, { i18nKey: 'userSettings.renameUser.mustDiffer' })

	if (getUserByUsername(newUsername))
		authMutationFail(400, { i18nKey: 'userSettings.renameUser.taken' })

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
		authMutationFail(400, {
			i18nKey: 'userSettings.renameUser.moveFailed',
			i18nParams: { detail: String(error?.message ?? error).slice(0, 240) },
		})
	}

	save_config()
	await events.emit('AfterUserRenamed', { oldUsername: currentUsername, newUsername })
}

/**
 * 从请求中获取用户信息。依赖于 authenticate 中间件已填充 req.user。
 * @param {import('npm:express').Request} req - Express 请求对象。
 * @returns {object} 用户对象。
 */
export function getUserByReq(req) {
	if (!req.user) throw httpError(401, 'Unauthorized')
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

// 预热 argon2，使 avgVerifyTime 在首次登录前已有参考值，用于暴力破解时序保护
let avgVerifyTime = 0
const timingCalibrated = argon2Loaded.then(async () => {
	const startTime = Date.now()
	await verify('$argon2id$v=19$m=65536,t=3,p=4$ZHVtbXlkYXRh$ZHVtbXlkYXRhZGF0YQ', 'dummydata').catch(() => { })
	avgVerifyTime = Date.now() - startTime
})

/**
 * 记录一次失败的密码或 WebAuthn 验证，必要时锁定账户。
 * @param {object} user - 用户对象。
 * @returns {{ locked: false } | { locked: true, response: object }} 是否已触发锁定及可选 HTTP 响应体。
 */
export function bumpUserFailedLoginAttempts(user) {
	const authData = user.auth
	authData.loginAttempts = (authData.loginAttempts || 0) + 1
	if (authData.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
		authData.lockedUntil = Date.now() + ms(ACCOUNT_LOCK_TIME)
		authData.loginAttempts = 0
		save_config()
		console.warnI18n('fountConsole.auth.accountLockedLog', { username: user.username })
		return {
			locked: true,
			response: { status: 403, i18nKey: 'auth.error.accountLockedAttempts' },
		}
	}
	save_config()
	return { locked: false }
}

/**
 * 使用 API Key 登录并签发会话 Cookie（供自动化 / 前端 E2E 测试使用）。
 * @param {string} apiKey - API Key 明文。
 * @param {string} [deviceId='unknown'] - 设备标识符。
 * @param {import('npm:express').Request} req - Express 请求对象。
 * @returns {Promise<object>} 包含状态码、消息和令牌的对象。
 */
export async function loginWithApiKey(apiKey, deviceId = 'unknown', req) {
	const key = String(apiKey ?? '').trim()
	if (!key) return { status: 400, i18nKey: 'userSettings.apiKeys.verifyMissingApiKey' }

	const user = await verifyApiKey(key)
	if (!user) return { status: 401, i18nKey: 'auth.error.invalidCredentials' }

	return await completeSuccessfulLogin(user, deviceId, req)
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
	await timingCalibrated
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
			return { status: 200, accessToken, refreshToken }
		}
		// 时间攻击保护
		const delay = Math.max(0, avgVerifyTime * 0.9 + Math.random() * avgVerifyTime * 0.2)
		await new Promise(resolve => setTimeout(resolve, delay).unref())
		return { status: 401, i18nKey: 'auth.error.invalidCredentials', ...response }
	}

	if (!user) return await handleFailedLogin()

	const authData = user.auth
	if (authData.lockedUntil && authData.lockedUntil > Date.now()) {
		const timeLeft = msstr(authData.lockedUntil - Date.now())
		return { status: 403, i18nKey: 'auth.error.accountLockedRetry', i18nParams: { timeLeft } }
	}

	const startTime = Date.now()
	const isValidPassword = await verifyPassword(password, authData.password)
	avgVerifyTime = (avgVerifyTime * 3 + (Date.now() - startTime)) / 4

	if (!isValidPassword) {
		const bump = bumpUserFailedLoginAttempts(user)
		if (bump.locked) return bump.response
		return await handleFailedLogin()
	}

	// 登录成功
	return await completeSuccessfulLogin(user, deviceId, req)
}

/**
 * 密码或 WebAuthn 验证通过后：清除锁定与失败计数、确保用户目录、签发 JWT 并登记刷新令牌。
 * @param {object} user - config 中的用户对象（含 username、auth）。
 * @param {string} deviceId - 设备 ID。
 * @param {import('npm:express').Request} req - Express 请求对象。
 * @returns {Promise<{status: number, accessToken: string, refreshToken: string}>} 成功时的状态码与一对 JWT。
 */
export async function completeSuccessfulLogin(user, deviceId, req) {
	const { username } = user
	const authData = user.auth
	delete loginFailures[req.ip]
	authData.loginAttempts = 0
	authData.lockedUntil = null

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

	return { status: 200, accessToken, refreshToken }
}


/**
 * 注册一个新用户。
 * @param {string} username - 用户名。
 * @param {string} password - 密码。
 * @returns {Promise<object>} 包含状态码和用户信息的对象。
 */
export async function register(username, password) {
	if (getUserByUsername(username)?.auth) return { status: 409, i18nKey: 'auth.error.accountAlreadyExists' }
	const newUser = await createUser(username, password)
	return { status: 201, user: { username: newUser.username, userId: newUser.auth.userId, createdAt: newUser.createdAt } }
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
