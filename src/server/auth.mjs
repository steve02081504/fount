import * as jose from 'npm:jose'
import fs from 'node:fs'
import fse from 'npm:fs-extra@^11.0.0'
import crypto from 'node:crypto'
import { config, save_config, __dirname } from './server.mjs'
import path from 'node:path'
import argon2 from 'npm:argon2'
import { ms } from '../scripts/ms.mjs'
import { geti18n } from '../scripts/i18n.mjs'
import { is_local_ip_from_req } from '../scripts/ratelimit.mjs'
import { loadJsonFile } from '../scripts/json_loader.mjs'

const ACCESS_TOKEN_EXPIRY = '15m'
const REFRESH_TOKEN_EXPIRY = '30d'
const ACCOUNT_LOCK_TIME = '10m'
const MAX_LOGIN_ATTEMPTS = 3

let privateKey, publicKey

export async function initAuth(config) {
	if (!config.privateKey || !config.publicKey) {
		const { privateKey: newPrivateKey, publicKey: newPublicKey } = crypto.generateKeyPairSync('ec', {
			namedCurve: 'prime256v1',
		})

		const newPrivateKeyPEM = newPrivateKey.export({ type: 'pkcs8', format: 'pem' })
		const newPublicKeyPEM = newPublicKey.export({ type: 'spki', format: 'pem' })

		config.privateKey = newPrivateKeyPEM
		config.publicKey = newPublicKeyPEM
		privateKey = await jose.importPKCS8(newPrivateKeyPEM, 'ES256')
		publicKey = await jose.importSPKI(newPublicKeyPEM, 'ES256')
		save_config()
	} else {
		privateKey = await jose.importPKCS8(config.privateKey, 'ES256')
		publicKey = await jose.importSPKI(config.publicKey, 'ES256')
	}

	config.data.revokedTokens ??= {}
	config.data.users ??= {}
	for (const user in config.data.users)
		if (config.data.users[user].auth)
			config.data.users[user].auth.refreshTokens ??= []

	cleanupRevokedTokens()
	cleanupRefreshTokens()
}

/**
 * 生成 JWT (Access Token)
 */
export async function generateAccessToken(payload) {
	const jti = crypto.randomUUID() // Generate a unique identifier for the access token
	return await new jose.SignJWT({ ...payload, jti })
		.setProtectedHeader({ alg: 'ES256' })
		.setIssuedAt()
		.setExpirationTime(ACCESS_TOKEN_EXPIRY)
		.sign(privateKey)
}

/**
 * 生成刷新令牌 (Refresh Token)
 * @param {object} payload - 令牌的有效载荷
 * @param {string} deviceId - 设备的唯一标识符
 */
async function generateRefreshToken(payload, deviceId = 'unknown') {
	const refreshTokenId = crypto.randomUUID()
	return await new jose.SignJWT({ ...payload, jti: refreshTokenId, deviceId })
		.setProtectedHeader({ alg: 'ES256' })
		.setIssuedAt()
		.setExpirationTime(REFRESH_TOKEN_EXPIRY)
		.sign(privateKey)
}

/**
 * 验证 JWT (包括 Access Token 和 Refresh Token)
 */
async function verifyToken(token) {
	try {
		const { payload } = await jose.jwtVerify(token, publicKey, {
			algorithms: ['ES256'],
		})
		return payload
	} catch (error) {
		console.error(await geti18n('fountConsole.auth.tokenVerifyError', { error }))
		return null
	}
}

/**
 * 刷新 Access Token
 */
async function refresh(refreshToken) {
	try {
		const decoded = await verifyToken(refreshToken)
		if (!decoded) return { status: 401, message: 'Invalid refresh token' }

		const user = getUserByUsername(decoded.username)
		const userRefreshToken = user?.auth.refreshTokens.find((token) => token.jti === decoded.jti)

		// 验证 refreshToken 是否存在、是否被撤销以及 deviceId 是否匹配（过期问题已被verifyToken验证）
		if (!user || !userRefreshToken || config.data.revokedTokens[decoded.jti] || userRefreshToken.deviceId !== decoded.deviceId)
			return { status: 401, message: 'Invalid refresh token' }

		// 生成新的 access token 和 refresh token
		const accessToken = await generateAccessToken({ username: decoded.username, userId: decoded.userId })
		const newRefreshToken = await generateRefreshToken({ username: decoded.username, userId: decoded.userId }, userRefreshToken.deviceId)
		const decodedNewRefreshToken = jose.decodeJwt(newRefreshToken) // 解码 newRefreshToken

		// 移除旧的 refreshToken，添加新的 refreshToken
		user.auth.refreshTokens = user.auth.refreshTokens.filter((token) => token.jti !== decoded.jti)
		user.auth.refreshTokens.push({
			jti: decodedNewRefreshToken.jti,
			deviceId: userRefreshToken.deviceId,
			expiry: Date.now() + ms(REFRESH_TOKEN_EXPIRY),
		})
		save_config()

		return { status: 200, accessToken, refreshToken: newRefreshToken }
	} catch (error) {
		console.error(await geti18n('fountConsole.auth.refreshTokenError', { error }))
		return { status: 401, message: 'Invalid refresh token' }
	}
}

/**
 * 用户登出
 */
export async function logout(req, res) {
	const { user, cookies: { accessToken, refreshToken } } = req

	if (accessToken) {
		// 将 accessToken 添加到 revokedTokens 中
		const decodedAccessToken = await jose.decodeJwt(accessToken)
		if (decodedAccessToken && decodedAccessToken.exp)
			config.data.revokedTokens[decodedAccessToken.jti] = { expiry: decodedAccessToken.exp * 1000, type: 'access' }
	}

	if (refreshToken && user)
		try {
			const decodedRefreshToken = await verifyToken(refreshToken)
			if (decodedRefreshToken) {
				// 从用户的 refreshToken 列表中移除当前的 refreshToken，并将其添加到 revokedTokens
				const userRefreshTokenIndex = user.auth.refreshTokens.findIndex((token) => token.jti === decodedRefreshToken.jti)
				if (userRefreshTokenIndex !== -1) {
					user.auth.refreshTokens.splice(userRefreshTokenIndex, 1)
					config.data.revokedTokens[decodedRefreshToken.jti] = { expiry: Date.now() + ms(REFRESH_TOKEN_EXPIRY), type: 'refresh' }
				}
			}
		} catch (error) {
			console.error(await geti18n('fountConsole.auth.logoutRefreshTokenProcessError', { error }))
		}

	res.clearCookie('accessToken')
	res.clearCookie('refreshToken')
	save_config()
	res.status(200).json({ message: 'Logout successful' })
}

/**
 * 身份验证中间件
 */
export async function authenticate(req, res, next) {
	const { accessToken, refreshToken } = req.cookies

	const Unauthorized = () => {
		const path = encodeURIComponent(req.originalUrl)
		if (req.accepts('html')) return res.redirect('/login?redirect=' + path)
		return res.status(401).json({ message: 'Unauthorized' })
	}
	if (!accessToken) return Unauthorized()

	// 本地 IP
	if (is_local_ip_from_req(req)) {
		// 解密 accessToken而无需验证
		const decoded = await jose.decodeJwt(accessToken)
		if (config.data.users[decoded.username])
			return next()
		return Unauthorized()
	}

	let decoded = await verifyToken(accessToken)

	if (!decoded) {
		// accessToken 无效，尝试使用 refreshToken 刷新
		if (!refreshToken) return Unauthorized()

		const refreshResult = await refresh(refreshToken)
		if (refreshResult.status !== 200) {
			// refreshToken 也无效，需要重新登录
			res.clearCookie('accessToken')
			res.clearCookie('refreshToken')
			return Unauthorized()
		}

		// 刷新成功，设置新的 accessToken 和 refreshToken 到 Cookie
		const newAccessToken = refreshResult.accessToken
		const newRefreshToken = refreshResult.refreshToken
		res.cookie('accessToken', newAccessToken, { httpOnly: true, secure: false })
		res.cookie('refreshToken', newRefreshToken, { httpOnly: true, secure: false })
		req.cookies.accessToken = newAccessToken
		req.cookies.refreshToken = newRefreshToken

		// 使用新的 accessToken 重新验证
		decoded = await verifyToken(newAccessToken)
	}

	req.user = decoded
	next()
}

/**
 * 撤销令牌 (将 Access Token 或 Refresh Token 添加到撤销列表)
 */
async function revokeToken(token) {
	const decoded = await jose.decodeJwt(token)
	if (!decoded || !decoded.jti) return console.error(await geti18n('fountConsole.auth.revokeTokenNoJTI'))
	const tokenType = decoded.exp ? decoded.exp * 1000 - Date.now() > ms(ACCESS_TOKEN_EXPIRY) ? 'refresh' : 'access' : 'unknown'

	if (decoded && decoded.exp) {
		config.data.revokedTokens[decoded.jti] = { expiry: decoded.exp * 1000, type: tokenType }
		save_config()
	}
}

/**
 * 通过用户名获取用户信息
 */
export function getUserByUsername(username) {
	return config.data.users[username]
}

export function getAllUserNames() {
	return Object.keys(config.data.users)
}

export function getAllUsers() {
	return config.data.users
}

/**
 * 创建新用户
 */
async function createUser(username, password) {
	const hashedPassword = await hashPassword(password)
	const userId = crypto.randomUUID()
	config.data.users[username] = {
		username,
		auth: {
			userId,
			password: hashedPassword,
			loginAttempts: 0,
			lockedUntil: null,
			refreshTokens: [],
		},
		...loadJsonFile(__dirname + '/default/templates/user.json'),
	}
	save_config()
	return { ...config.data.users[username], userId }
}

/**
 * 使用 Argon2id 哈希密码
 */
async function hashPassword(password) {
	return await argon2.hash(password, { type: argon2.argon2id })
}

/**
 * 验证密码
 */
async function verifyPassword(password, hashedPassword) {
	return await argon2.verify(hashedPassword, password)
}

async function getUserByToken(token) {
	if (!token) return null

	const decoded = jose.decodeJwt(token)
	if (!decoded) return null

	return config.data.users[decoded.username]
}

export function getUserDictionary(username) {
	return path.resolve(config.data.users[username]?.UserDictionary || __dirname + '/data/users/' + username)
}

export function getUserByReq(req) {
	return getUserByToken(req.cookies.accessToken)
}

/**
 * 用户登录
 */
export async function login(username, password, deviceId = 'unknown') {
	const user = getUserByUsername(username)
	if (!user) return { status: 404, message: 'User not found' }

	const authData = user.auth

	// 检查账户是否被锁定
	if (authData.lockedUntil && authData.lockedUntil > Date.now())
		return { status: 403, message: 'Account locked' }

	const isValidPassword = await verifyPassword(password, authData.password)
	if (!isValidPassword) {
		authData.loginAttempts++
		if (authData.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
			authData.lockedUntil = Date.now() + ms(ACCOUNT_LOCK_TIME)
			authData.loginAttempts = 0 // 达到最大尝试次数后重置尝试次数
			// 账户锁定逻辑：如果登录尝试次数超过限制，锁定账户一段时间
			// 此处记录日志或发送通知
			console.log(await geti18n('fountConsole.auth.accountLockedLog', { username }))
		}
		save_config()
		return { status: 401, message: 'Invalid password' }
	}

	// 重置登录尝试次数
	if (authData.loginAttempts !== 0 || authData.lockedUntil !== null) {
		authData.loginAttempts = 0
		authData.lockedUntil = null
	}

	const userdir = getUserDictionary(username)
	if (!fs.existsSync(userdir)) try {
		fs.mkdirSync(path.dirname(userdir), { recursive: true })
		// 自`/default/user`复制到用户目录
		fse.copySync(path.join(__dirname, '/default/templates/user'), userdir)
	} catch { }
	for (const subdir of ['AIsources', 'chars', 'personas', 'settings', 'shells', 'worlds', 'ImportHandlers', 'AIsourceGenerators'])
		try { fs.mkdirSync(userdir + '/' + subdir, { recursive: true }) } catch {
			console.error('Failed to create directory:', userdir + '/' + subdir, error)
		}

	// 生成 access token 和 refresh token
	const accessToken = await generateAccessToken({ username: user.username, userId: authData.userId })
	const refreshToken = await generateRefreshToken({ username: user.username, userId: authData.userId }, deviceId)
	const decodedRefreshToken = jose.decodeJwt(refreshToken) // 解码 refreshToken 以获取 jti

	// 移除同一个设备上的旧的 refresh token
	authData.refreshTokens = authData.refreshTokens.filter((token) => token.deviceId !== deviceId)
	// 存储 refresh token
	authData.refreshTokens.push({
		jti: decodedRefreshToken.jti,
		deviceId,
		expiry: Date.now() + ms(REFRESH_TOKEN_EXPIRY),
	})
	save_config()

	return { status: 200, message: 'Login successful', accessToken, refreshToken }
}

/**
 * 用户注册
 */
export async function register(username, password) {
	const existingUser = getUserByUsername(username)
	if (existingUser?.auth)
		return { status: 409, message: 'Username already exists' }

	const newUser = await createUser(username, password)
	return { status: 201, user: newUser }
}

/**
 * 清理过期的已撤销 token (每小时调用一次)
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
 * 清理过期的 refresh token (每小时调用一次)
 */
function cleanupRefreshTokens() {
	const now = Date.now()
	let cleaned = false
	for (const username in config.data.users) {
		const user = config.data.users[username]
		const initialLength = user.auth.refreshTokens.length
		user.auth.refreshTokens = user.auth.refreshTokens.filter((token) =>
			token.expiry > now && !config.data.revokedTokens[token.jti]
		)
		if (user.auth.refreshTokens.length !== initialLength) cleaned = true
	}

	if (cleaned) save_config()
}

setInterval(() => {
	cleanupRevokedTokens()
	cleanupRefreshTokens()
}, ms('1h'))
