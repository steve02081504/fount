import { Buffer } from 'node:buffer'

import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from 'npm:@simplewebauthn/server'

import { ms } from '../scripts/ms.mjs'

import {
	bumpUserFailedLoginAttempts,
	completeSuccessfulLogin,
	getUserByUsername,
	verifyPassword,
} from './auth.mjs'
import { save_config } from './server.mjs'

const CHALLENGE_TTL_MS = ms('5m')

/** @type {Map<string, { challenge: string, expires: number }>} */
const webauthnChallenges = new Map()

/**
 * @param {'registration' | 'authentication'} type - 挑战用途：注册或认证。
 * @param {string} username - 用户名。
 * @returns {string} 用于内存 Map 的键。
 */
function challengeKey(type, username) {
	return `${type}:${username}`
}

/**
 * @param {'registration' | 'authentication'} type - 挑战用途：注册或认证。
 * @param {string} username - 用户名。
 * @param {string} challenge - WebAuthn 挑战（base64url）。
 * @returns {void} 无返回值。
 */
function setWebAuthnChallenge(type, username, challenge) {
	webauthnChallenges.set(challengeKey(type, username), {
		challenge,
		expires: Date.now() + CHALLENGE_TTL_MS,
	})
}

/**
 * @param {'registration' | 'authentication'} type - 挑战用途：注册或认证。
 * @param {string} username - 用户名。
 * @returns {{ challenge: string } | null} 未过期则返回挑战，否则为 null。
 */
function takeWebAuthnChallenge(type, username) {
	const key = challengeKey(type, username)
	const entry = webauthnChallenges.get(key)
	webauthnChallenges.delete(key)
	if (!entry || entry.expires < Date.now()) return null
	return entry
}

/**
 * @param {import('npm:express').Request} req - HTTP 请求（Host、Origin 等）。
 * @returns {{ rpID: string, origin: string, rpName: string }} 依赖方 ID、来源与显示名。
 */
export function getWebAuthnRelyingParty(req) {
	const host = req.headers.host?.split(':')[0] || 'localhost'
	const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http')
	const origin = req.headers.origin || `${proto}://${req.headers.host || 'localhost'}`
	return { rpID: host, origin, rpName: 'fount' }
}

/**
 * @param {string} username - 当前登录用户名。
 * @param {import('npm:express').Request} req - HTTP 请求。
 * @returns {Promise<{ status: number, success: boolean, message?: string, options?: object, rp?: object }>} 注册选项或错误信息。
 */
export async function webauthnRegistrationBegin(username, req) {
	const user = getUserByUsername(username)
	if (!user?.auth) return { status: 404, success: false, message: 'User not found' }
	user.auth.webauthnCredentials ??= []

	const { rpID, origin, rpName } = getWebAuthnRelyingParty(req)
	const options = await generateRegistrationOptions({
		rpName,
		rpID,
		userID: new TextEncoder().encode(user.auth.userId),
		userName: username,
		userDisplayName: username,
		excludeCredentials: user.auth.webauthnCredentials.map(c => ({
			id: c.id,
			type: 'public-key',
			transports: c.transports,
		})),
		authenticatorSelection: {
			residentKey: 'preferred',
			userVerification: 'preferred',
		},
		attestationType: 'none',
	})

	setWebAuthnChallenge('registration', username, options.challenge)
	return { status: 200, success: true, options, rp: { rpID, origin } }
}

/**
 * @param {string} username - 当前登录用户名。
 * @param {object} credentialResponse - 浏览器 `navigator.credentials.create` 的 JSON 结果。
 * @param {string} [nickname] - 用户备注名（可选）。
 * @param {import('npm:express').Request} req - HTTP 请求。
 * @returns {Promise<{ status: number, success: boolean, message: string }>} HTTP 状态与结果消息。
 */
export async function webauthnRegistrationComplete(username, credentialResponse, nickname, req) {
	const pending = takeWebAuthnChallenge('registration', username)
	if (!pending) return { status: 401, success: false, message: 'Registration session expired' }

	const user = getUserByUsername(username)
	if (!user?.auth) return { status: 404, success: false, message: 'User not found' }
	user.auth.webauthnCredentials ??= []

	const { rpID, origin } = getWebAuthnRelyingParty(req)

	try {
		const result = await verifyRegistrationResponse({
			response: credentialResponse,
			expectedChallenge: pending.challenge,
			expectedOrigin: origin,
			expectedRPID: rpID,
			requireUserVerification: false,
		})

		if (!result.verified || !result.registrationInfo)
			return { status: 400, success: false, message: 'Passkey registration could not be verified' }

		const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo
		const publicKeyB64 = Buffer.from(credential.publicKey).toString('base64url')

		user.auth.webauthnCredentials.push({
			id: credential.id,
			publicKey: publicKeyB64,
			counter: credential.counter,
			transports: credential.transports,
			credentialDeviceType,
			credentialBackedUp,
			name: (nickname || '').trim().slice(0, 64) || credential.id.slice(0, 12),
			createdAt: Date.now(),
		})
		save_config()
		return { status: 200, success: true, message: 'Passkey registered successfully' }
	} catch (error) {
		console.error('Passkey registration verification failed:', error)
		return { status: 400, success: false, message: error?.message || 'Passkey registration failed' }
	}
}

/**
 * @param {string} username - 待登录用户名。
 * @param {import('npm:express').Request} req - HTTP 请求。
 * @returns {Promise<{ status: number, success: boolean, message?: string, options?: object }>} 认证选项或错误信息。
 */
export async function webauthnLoginBegin(username, req) {
	const user = getUserByUsername(username)
	const authData = user?.auth
	const genericUnavailable = {
		status: 401,
		success: false,
		message: 'Passkey sign-in is not available for this account',
	}

	if (!authData) return genericUnavailable
	if (authData.lockedUntil && authData.lockedUntil > Date.now()) {
		const timeLeft = ms(authData.lockedUntil - Date.now(), { long: true })
		return { status: 403, success: false, message: `Account locked. Try again in ${timeLeft}.` }
	}

	const creds = authData.webauthnCredentials || []
	if (!creds.length) return genericUnavailable

	const { rpID } = getWebAuthnRelyingParty(req)
	const options = await generateAuthenticationOptions({
		rpID,
		allowCredentials: creds.map(c => ({
			id: c.id,
			type: 'public-key',
			transports: c.transports,
		})),
		userVerification: 'preferred',
	})

	setWebAuthnChallenge('authentication', username, options.challenge)
	return { status: 200, success: true, options }
}

/**
 * @param {object} credentialResponse - 浏览器 `navigator.credentials.get` 的 JSON 结果。
 * @param {string} username - 待登录用户名。
 * @param {string} deviceId - 客户端设备 ID。
 * @param {import('npm:express').Request} req - HTTP 请求。
 * @returns {Promise<object>} 与密码登录相同形状的响应（含 accessToken 等）或错误对象。
 */
export async function webauthnLoginComplete(credentialResponse, username, deviceId, req) {
	const pending = takeWebAuthnChallenge('authentication', username)
	if (!pending)
		return { status: 401, success: false, message: 'Authentication session expired' }

	const user = getUserByUsername(username)
	if (!user?.auth)
		return { status: 401, success: false, message: 'Passkey sign-in is not available for this account' }

	const authData = user.auth
	if (authData.lockedUntil && authData.lockedUntil > Date.now()) {
		const timeLeft = ms(authData.lockedUntil - Date.now(), { long: true })
		return { status: 403, success: false, message: `Account locked. Try again in ${timeLeft}.` }
	}

	const creds = authData.webauthnCredentials || []
	const credId = credentialResponse?.id
	const stored = creds.find(c => c.id === credId)
	if (!stored)
		return { status: 401, success: false, message: 'Unknown passkey' }

	const { rpID, origin } = getWebAuthnRelyingParty(req)
	const credential = {
		id: stored.id,
		publicKey: Buffer.from(stored.publicKey, 'base64url'),
		counter: stored.counter,
		transports: stored.transports,
	}

	try {
		const result = await verifyAuthenticationResponse({
			response: credentialResponse,
			expectedChallenge: pending.challenge,
			expectedOrigin: origin,
			expectedRPID: rpID,
			credential,
			requireUserVerification: false,
		})

		if (!result.verified) {
			const bump = bumpUserFailedLoginAttempts(user)
			if (bump.locked) return bump.response
			return { status: 401, success: false, message: 'Passkey verification failed' }
		}

		stored.counter = result.authenticationInfo.newCounter
		save_config()

		return await completeSuccessfulLogin(user, deviceId, req)
	} catch (error) {
		console.error('Passkey authentication verification failed:', error)
		const bump = bumpUserFailedLoginAttempts(user)
		if (bump.locked) return bump.response
		return { status: 401, success: false, message: error?.message || 'Passkey verification failed' }
	}
}

/**
 * @param {string} username - 用户名。
 * @returns {object[]} 不含公钥的凭据摘要列表。
 */
export function listWebAuthnCredentials(username) {
	const user = getUserByUsername(username)
	const creds = user?.auth?.webauthnCredentials || []
	return creds.map(c => ({
		id: c.id,
		name: c.name || '',
		createdAt: c.createdAt,
		credentialDeviceType: c.credentialDeviceType,
	}))
}

/**
 * @param {string} username - 用户名。
 * @param {string} credentialId - 凭据 ID（base64url）。
 * @param {string} password - 账户密码（校验用）。
 * @returns {Promise<{ success: boolean, message: string }>} 是否成功及说明。
 */
export async function removeWebAuthnCredential(username, credentialId, password) {
	const user = getUserByUsername(username)
	if (!user?.auth?.webauthnCredentials) return { success: false, message: 'User not found' }

	if (!await verifyPassword(password, user.auth.password))
		return { success: false, message: 'Invalid password' }

	const idx = user.auth.webauthnCredentials.findIndex(c => c.id === credentialId)
	if (idx === -1) return { success: false, message: 'Passkey not found' }

	user.auth.webauthnCredentials.splice(idx, 1)
	save_config()
	return { success: true, message: 'Passkey removed' }
}
