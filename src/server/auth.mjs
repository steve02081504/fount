import * as jose from 'npm:jose' // Use jose instead of jsonwebtoken
import fs from 'node:fs'
import crypto from 'node:crypto'
import { config, save_config, __dirname } from './server.mjs'
import path from 'node:path'
import argon2 from 'npm:argon2'

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
		config.data.users[user].auth.refreshTokens ??= []

	// 清理过期的 revokedTokens 和 refreshTokens
	cleanupRevokedTokens()
	cleanupRefreshTokens()
}

const ACCESS_TOKEN_EXPIRY = '15m' // 访问令牌有效期
const REFRESH_TOKEN_EXPIRY = '30d' // 刷新令牌有效期

/**
 * 生成 JWT
 */
async function generateAccessToken(payload) {
	const jti = crypto.randomUUID() // Generate a unique identifier for the access token
	return await new jose.SignJWT({ ...payload, jti })
		.setProtectedHeader({ alg: 'ES256' })
		.setIssuedAt()
		.setExpirationTime(ACCESS_TOKEN_EXPIRY)
		.sign(privateKey)
}

/**
 * 生成刷新令牌
 */
async function generateRefreshToken(payload, deviceId = 'unknown') {
	const refreshTokenId = crypto.randomUUID()
	const refreshToken = crypto.randomBytes(64).toString('hex')
	return {
		token: await new jose.SignJWT({ ...payload, jti: refreshTokenId })
			.setProtectedHeader({ alg: 'ES256' })
			.setIssuedAt()
			.setExpirationTime(REFRESH_TOKEN_EXPIRY)
			.sign(privateKey),
		id: refreshTokenId,
		hashedToken: hashToken(refreshToken),
		deviceId,
	}
}

/**
 * 验证 JWT
 */
async function verifyToken(token) {
	try {
		const { payload, protectedHeader } = await jose.jwtVerify(token, publicKey, {
			algorithms: ['ES256'],
		})

		// 检查令牌是否在撤销列表中
		const tokenHash = hashToken(token)
		const revokedToken = config.data.revokedTokens[tokenHash]
		if (revokedToken && revokedToken.expiry > Date.now())
			throw new Error('Token revoked')

		return payload
	} catch (error) {
		console.error(error)
		return null
	}
}

/**
 * 刷新令牌
 */
async function refresh(refreshToken) {
	try {
		const decoded = await verifyToken(refreshToken)
		if (!decoded) return { status: 401, message: 'Invalid refresh token' }
		const user = getUserByUsername(decoded.username)
		const userRefreshToken = user?.auth.refreshTokens.find((token) => token.jti === decoded.jti)
		if (!user || !userRefreshToken || userRefreshToken.hashedToken !== hashToken(refreshToken) || userRefreshToken.expiry < Date.now())
			return { status: 401, message: 'Invalid refresh token' }

		// 生成新的访问令牌和刷新令牌
		const accessToken = await generateAccessToken({ username: decoded.username, userId: decoded.userId })
		const newRefreshToken = await generateRefreshToken({ username: decoded.username, userId: decoded.userId }, userRefreshToken.deviceId)

		// 移除旧的 refreshToken，添加新的 refreshToken
		user.auth.refreshTokens = user.auth.refreshTokens.filter((token) => token.jti !== decoded.jti)
		user.auth.refreshTokens.push({
			jti: newRefreshToken.id,
			hashedToken: newRefreshToken.hashedToken,
			deviceId: userRefreshToken.deviceId,
			expiry: Date.now() + 30 * 24 * 60 * 60 * 1000,
		})
		save_config()

		return { status: 200, accessToken, refreshToken: newRefreshToken.token }
	} catch (error) {
		console.error(error)
		return { status: 401, message: 'Invalid refresh token' }
	}
}

/**
 * 用户登出
 */
async function logout(req, res) {
	const accessToken = req.cookies.accessToken
	const refreshToken = req.cookies.refreshToken
	const user = req.user
	if (accessToken) revokeToken(accessToken)
	if (refreshToken) {
		const decoded = await verifyToken(refreshToken)
		const userRefreshTokenIndex = user.auth.refreshTokens.findIndex((token) => token.jti === decoded.jti)
		if (userRefreshTokenIndex !== -1) {
			revokeToken(refreshToken)
			user.auth.refreshTokens.splice(userRefreshTokenIndex, 1)
		}
	}
	res.clearCookie('accessToken')
	res.clearCookie('refreshToken')
	save_config()
	res.status(200).json({ message: 'Logout successful' })
}

/**
 * 身份验证中间件
 */
async function authenticate(req, res, next) {
	const accessToken = req.cookies.accessToken
	let refreshToken = req.cookies.refreshToken // 获取 refreshToken

	if (!accessToken) return res.status(401).json({ message: 'Unauthorized' })

	let decoded = await verifyToken(accessToken)

	if (!decoded) {
		// accessToken 无效，尝试使用 refreshToken 刷新
		if (!refreshToken) return res.status(401).json({ message: 'Unauthorized' })

		const refreshResult = await refresh(refreshToken)
		if (refreshResult.status !== 200)
			// refreshToken 也无效，需要重新登录
			return res.status(401).json({ message: 'Invalid token' })

		// 刷新成功，设置新的 accessToken 和 refreshToken 到 Cookie
		const newAccessToken = refreshResult.accessToken
		const newRefreshToken = refreshResult.refreshToken
		res.cookie('accessToken', newAccessToken, { httpOnly: true, secure: false }) // 根据需要调整 secure 选项
		res.cookie('refreshToken', newRefreshToken, { httpOnly: true, secure: false })
		req.cookies.accessToken = newAccessToken
		req.cookies.refreshToken = newRefreshToken

		// 使用新的 accessToken 重新验证
		decoded = await verifyToken(newAccessToken)
		req.user = decoded
	} else req.user = decoded

	next()
}

/**
 * 撤销令牌 (将令牌添加到撤销列表)
 */
async function revokeToken(token) {
	const tokenHash = hashToken(token)
	const decoded = await jose.decodeJwt(token)

	if (decoded && decoded.exp) {
		config.data.revokedTokens[tokenHash] = { expiry: decoded.exp * 1000 } // 存储过期时间 (毫秒)
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
			refreshTokens: [], // 初始化 refreshTokens 数组
		},
	}
	save_config()
	return config.data.users[username]
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

/**
 * 计算 token 的 SHA-256 哈希值
 */
function hashToken(token) {
	return crypto.createHash('sha256').update(token).digest('hex')
}

export async function getUserByToken(token) {
	if (!token) return null

	const decoded = await verifyToken(token)
	if (!decoded) return null

	return config.data.users[decoded.username]
}

export function getUserDictionary(username) {
	return path.resolve(config.data.users[username]?.UserDictionary || __dirname + '/data/users/' + username)
}

/**
 * 用户登录
 */
async function login(username, password, deviceId = 'unknown') {
	const user = getUserByUsername(username)
	if (!user) return { status: 404, message: 'User not found' }

	const authData = user.auth

	// 检查账户是否被锁定
	if (authData.lockedUntil && authData.lockedUntil > Date.now())
		return { status: 403, message: 'Account locked' }

	const isValidPassword = await verifyPassword(password, authData.password)
	if (!isValidPassword) {
		authData.loginAttempts++
		if (authData.loginAttempts >= 3)
			authData.lockedUntil = Date.now() + 10 * 60 * 1000

		save_config()
		return { status: 401, message: 'Invalid password' }
	}

	authData.loginAttempts = 0

	const userdir = getUserDictionary(username)
	fs.mkdirSync(userdir, { recursive: true })
	for (let subdir of ['AIsources', 'chars', 'personas', 'settings', 'shells', 'worlds', 'charTemplates', 'AIsourceGenerators'])
		fs.mkdirSync(userdir + '/' + subdir, { recursive: true })

	// 生成访问令牌和刷新令牌
	const accessToken = await generateAccessToken({ username: user.username, userId: authData.userId })
	const refreshToken = await generateRefreshToken({ username: user.username, userId: authData.userId }, deviceId) // 传入 deviceId

	// 存储刷新令牌
	authData.refreshTokens.push({
		jti: refreshToken.id,
		hashedToken: refreshToken.hashedToken,
		deviceId,
		expiry: Date.now() + 30 * 24 * 60 * 60 * 1000,
	})
	save_config()

	return { status: 200, message: 'Login successful', accessToken, refreshToken: refreshToken.token }
}

/**
 * 用户注册
 */
async function register(username, password) {
	const existingUser = getUserByUsername(username)
	if (existingUser?.auth) return { status: 409, message: 'Username already exists' }

	const newUser = await createUser(username, password)
	return { status: 201, user: newUser }
}

/**
 * 清理过期的已撤销 token
 */
function cleanupRevokedTokens() {
	const now = Date.now()
	let cleaned = false
	for (const tokenHash in config.data.revokedTokens)
		if (config.data.revokedTokens[tokenHash].expiry <= now) {
			delete config.data.revokedTokens[tokenHash]
			cleaned = true
		}

	if (cleaned) save_config()
}

/**
 * 清理过期的 refresh token
 */
function cleanupRefreshTokens() {
	const now = Date.now()
	let cleaned = false
	for (const username in config.data.users) {
		const user = config.data.users[username]
		const initialLength = user.auth.refreshTokens.length
		user.auth.refreshTokens = user.auth.refreshTokens.filter((token) => token.expiry > now)
		if (user.auth.refreshTokens.length !== initialLength) cleaned = true
	}

	if (cleaned) save_config()
}

setInterval(cleanupRevokedTokens, 60 * 60 * 1000) // 每小时清理一次过期的 revokedTokens
setInterval(cleanupRefreshTokens, 60 * 60 * 1000) // 每小时清理一次过期的 refreshTokens

// 导出函数
export { login, register, logout, authenticate, refresh }
