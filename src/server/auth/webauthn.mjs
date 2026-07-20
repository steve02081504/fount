import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'

import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from 'npm:@simplewebauthn/server'
import { on_shutdown } from 'npm:on-shutdown'

import { ms, msstr } from '../../scripts/ms.mjs'
import { save_config } from '../server.mjs'

import {
	authMutationFail,
	bumpUserFailedLoginAttempts,
	completeSuccessfulLogin,
	getAllUserNames,
	getUserByUsername,
	verifyPassword,
} from './index.mjs'

const CHALLENGE_TTL_MS = ms('5m')

/**
 * 待验证的 WebAuthn 挑战缓存。
 * @type {Map<string, { challenge: string, expires: number }>}
 */
const webauthnChallenges = new Map()

/**
 * 清理已过期的 WebAuthn 挑战，避免 Map 无限增长。
 * @returns {void}
 */
function sweepExpiredWebAuthnChallenges() {
	const now = Date.now()
	for (const [key, entry] of webauthnChallenges.entries())
		if (entry.expires <= now) webauthnChallenges.delete(key)
}

const webauthnChallengeCleanupInterval = setInterval(
	sweepExpiredWebAuthnChallenges,
	Math.max(Math.floor(CHALLENGE_TTL_MS / 2), 60_000),
)

on_shutdown(() => {
	clearInterval(webauthnChallengeCleanupInterval)
})

/**
 * 存储带过期时间的 WebAuthn 挑战。
 * @param {string} key - Map 键。
 * @param {string} challenge - WebAuthn 挑战（base64url）。
 * @returns {void}
 */
function storeWebAuthnChallenge(key, challenge) {
	webauthnChallenges.set(key, {
		challenge,
		expires: Date.now() + CHALLENGE_TTL_MS,
	})
}

/**
 * 取出并删除 WebAuthn 挑战条目。
 * @param {string} key - Map 键。
 * @returns {{ challenge: string } | null} 未过期则返回挑战条目，否则为 null。
 */
function takeWebAuthnChallengeEntry(key) {
	const entry = webauthnChallenges.get(key)
	webauthnChallenges.delete(key)
	if (!entry || entry.expires < Date.now()) return null
	return entry
}

/**
 * 根据凭据 id 在用户库中查找用户及已存凭据记录（用于无用户名 Passkey 登录）。
 * 复杂度 O(用户数 × 每用户凭证数)；用户量大时可改为 credentialId → 用户的索引。
 * @param {string} credentialId - base64url 凭据 id。
 * @returns {{ user: object, stored: object } | null} 匹配则返回用户与凭据记录，否则为 null。
 */
function findUserByWebAuthnCredentialId(credentialId) {
	if (!credentialId) return null
	for (const username of getAllUserNames()) {
		const user = getUserByUsername(username)
		const creds = user?.auth?.webauthnCredentials || []
		const stored = creds.find(c => c.id === credentialId)
		if (stored) return { user, stored }
	}
	return null
}

/**
 * 从请求中解析 WebAuthn 依赖方信息。
 * @param {import('npm:express').Request} req - HTTP 请求（Host、Origin 等）。
 * @returns {{ rpID: string, origin: string, rpName: string }} 依赖方 ID、来源与显示名。
 */
export function getWebAuthnRelyingParty(req) {
	const proto = String(req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http')).split(',')[0].trim()
	const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim()
	const rpID = req.hostname || 'localhost'
	const origin = req.headers.origin || `${proto}://${forwardedHost}`
	return { rpID, origin, rpName: 'fount' }
}

/**
 * 开始 Passkey 注册流程，下发注册选项。
 * @param {string} username - 当前登录用户名。
 * @param {import('npm:express').Request} req - HTTP 请求。
 * @returns {Promise<{ status: number, success: boolean, options?: object, rp?: object, i18nKey?: string }>} 注册选项或错误信息。
 */
export async function webauthnRegistrationBegin(username, req) {
	const user = getUserByUsername(username)
	if (!user?.auth) return { status: 404, i18nKey: 'auth.webauthn.registrationUserNotFound' }
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
			residentKey: 'required',
			userVerification: 'required',
		},
		attestationType: 'none',
	})

	storeWebAuthnChallenge(`registration:${username}`, options.challenge)
	return { status: 200, options, rp: { rpID, origin } }
}

/**
 * 完成 Passkey 注册，验证凭据并写入用户库。
 * @param {string} username - 当前登录用户名。
 * @param {object} credentialResponse - 浏览器 `navigator.credentials.create` 的 JSON 结果。
 * @param {string} [nickname] - 用户备注名（可选）。
 * @param {import('npm:express').Request} req - HTTP 请求。
 * @returns {Promise<{ status: number, success: boolean, i18nKey?: string }>} HTTP 状态与结果。
 */
export async function webauthnRegistrationComplete(username, credentialResponse, nickname, req) {
	const pending = takeWebAuthnChallengeEntry(`registration:${username}`)
	if (!pending)
		return { status: 401, i18nKey: 'auth.webauthn.registrationSessionExpired' }

	const user = getUserByUsername(username)
	if (!user?.auth) return { status: 404, i18nKey: 'auth.webauthn.registrationUserNotFound' }
	user.auth.webauthnCredentials ??= []

	const { rpID, origin } = getWebAuthnRelyingParty(req)

	try {
		const result = await verifyRegistrationResponse({
			response: credentialResponse,
			expectedChallenge: pending.challenge,
			expectedOrigin: origin,
			expectedRPID: rpID,
			requireUserVerification: true,
		})

		if (!result.verified || !result.registrationInfo)
			return { status: 400, i18nKey: 'auth.webauthn.registrationVerifyFailed' }

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
		return { status: 200 }
	} catch (error) {
		console.error('Passkey registration verification failed:', error)
		return { status: 400, i18nKey: 'auth.webauthn.registrationFailed' }
	}
}

/**
 * Passkey 登录 begin：下发空 allowCredentials，凭据 id 在 complete 阶段反查用户。
 * @param {import('npm:express').Request} req - HTTP 请求。
 * @returns {Promise<{ status: number, success: boolean, options?: object, authSessionToken?: string }>} HTTP 状态与认证选项及会话令牌。
 */
export async function webauthnLoginBegin(req) {
	const { rpID } = getWebAuthnRelyingParty(req)
	const options = await generateAuthenticationOptions({
		rpID,
		allowCredentials: [],
		userVerification: 'required',
	})

	const authSessionToken = randomBytes(32).toString('hex')
	storeWebAuthnChallenge(`authentication_discoverable:${authSessionToken}`, options.challenge)
	return { status: 200, options, authSessionToken }
}

/**
 * Passkey 登录 complete：凭 authSessionToken 取挑战，凭凭据 id 定位用户。
 * @param {object} credentialResponse - 浏览器 `navigator.credentials.get` 的 JSON 结果。
 * @param {string} authSessionToken - begin 返回的会话令牌。
 * @param {string} deviceId - 客户端设备 ID。
 * @param {import('npm:express').Request} req - HTTP 请求。
 * @returns {Promise<object>} 成功时与 {@link ./auth/index.mjs} `completeSuccessfulLogin` 同类字段；失败时含 `status`、`i18nKey`（及可选 `i18nParams`）。
 */
export async function webauthnLoginComplete(credentialResponse, authSessionToken, deviceId, req) {
	const pending = takeWebAuthnChallengeEntry(`authentication_discoverable:${authSessionToken || ''}`)
	if (!pending)
		return { status: 401, i18nKey: 'auth.webauthn.apiSessionExpired' }

	const credId = credentialResponse?.id
	const found = findUserByWebAuthnCredentialId(credId)
	if (!found)
		return { status: 401, i18nKey: 'auth.webauthn.apiUnknownPasskey' }

	const { user, stored } = found
	const authData = user.auth
	if (authData.lockedUntil && authData.lockedUntil > Date.now()) {
		const timeLeft = msstr(authData.lockedUntil - Date.now())
		return { status: 403, i18nKey: 'auth.error.accountLockedRetry', i18nParams: { timeLeft } }
	}

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
			requireUserVerification: true,
		})

		if (!result.verified) {
			const bump = bumpUserFailedLoginAttempts(user)
			if (bump.locked) return bump.response
			return { status: 401, i18nKey: 'auth.webauthn.apiPasskeyVerificationFailed' }
		}

		stored.counter = result.authenticationInfo.newCounter
		save_config()

		return await completeSuccessfulLogin(user, deviceId, req)
	} catch (error) {
		console.error('Passkey authentication verification failed:', error)
		const bump = bumpUserFailedLoginAttempts(user)
		if (bump.locked) return bump.response
		return { status: 401, i18nKey: 'auth.webauthn.apiPasskeyVerificationFailed' }
	}
}

/**
 * 列出用户已注册的 Passkey 凭据摘要。
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
 * 删除用户指定的 Passkey 凭据（需验证密码）。
 * @param {string} username - 用户名。
 * @param {string} credentialId - 凭据 ID（base64url）。
 * @param {string} password - 账户密码（校验用）。
 * @returns {Promise<void>}
 */
export async function removeWebAuthnCredential(username, credentialId, password) {
	const user = getUserByUsername(username)
	if (!user?.auth?.webauthnCredentials)
		authMutationFail(400, { i18nKey: 'auth.webauthn.removeUserNotFound' })

	if (!await verifyPassword(password, user.auth.password))
		authMutationFail(401, { i18nKey: 'auth.webauthn.removeInvalidPassword' })

	const idx = user.auth.webauthnCredentials.findIndex(c => c.id === credentialId)
	if (idx === -1)
		authMutationFail(400, { i18nKey: 'auth.webauthn.removePasskeyNotFound' })

	user.auth.webauthnCredentials.splice(idx, 1)
	save_config()
}
