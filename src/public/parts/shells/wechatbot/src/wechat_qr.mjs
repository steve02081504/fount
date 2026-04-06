/**
 * 微信 iLink 扫码登录（与官方渠道插件同源接口：get_bot_qrcode / get_qrcode_status）。
 * @returns {any} 返回值。
 */
import { randomUUID } from 'node:crypto'

import { apiGetFetch, DEFAULT_WECHAT_ILINK_BASE, ensureTrailingSlash } from './wechat_api.mjs'

const DEFAULT_BOT_TYPE = '3'
const GET_QRCODE_TIMEOUT_MS = 5000
const QR_LONG_POLL_TIMEOUT_MS = 35_000
const SESSION_TTL_MS = 5 * 60_000
const MAX_QR_REFRESH = 3

/**
 * @param {string} qrcode 二维码标识
 * @returns {string} 微信 liteapp 扫码页完整 URL
 */
const buildQrCodeUrl = qrcode => `https://liteapp.weixin.qq.com/q/7GiQu1?bot_type=3&qrcode=${qrcode}`

/**
 * @typedef {{
 *   username: string
 *   botname: string | null
 *   qrcode: string
 *   currentApiBaseUrl: string
 *   startedAt: number
 *   qrRefreshCount: number
 * }} QrSession
 */

/** @type {Map<string, QrSession>} */
const sessions = new Map()

/**
 *
 * @returns {any} 返回值。
 */
function purgeExpired() {
	const now = Date.now()
	for (const [key, session] of sessions)
		if (now - session.startedAt > SESSION_TTL_MS)
			sessions.delete(key)
}

/**
 * @param {string | undefined} baseurl 基础地址字符串。
 * @returns {any} 返回值。
 */
function normalizeServiceBaseUrl(baseurl) {
	if (!baseurl?.trim())
		return ensureTrailingSlash(DEFAULT_WECHAT_ILINK_BASE)
	const trimmed = baseurl.trim()
	return ensureTrailingSlash(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`)
}

/**
 * Fetches a fresh QR code image from the iLink gateway.
 * @returns {Promise<{ qrcode: string, qrcode_img_content: string }>} 返回二维码数据。
 */
async function fetchFreshQrCode() {
	const rawText = await apiGetFetch({
		baseUrl: DEFAULT_WECHAT_ILINK_BASE,
		endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(DEFAULT_BOT_TYPE)}`,
		timeoutMs: GET_QRCODE_TIMEOUT_MS,
	})
	const qr = JSON.parse(rawText)
	if (!qr.qrcode || !qr.qrcode_img_content)
		throw new Error('服务器未返回二维码')

	return qr
}

/**
 * @param {string} username 用户名。
 * @param {string | null} botname 机器人名称。
 * @returns {Promise<any>} 二维码内容与图片地址。
 */
export async function startQrSession({ username, botname }) {
	purgeExpired()

	const qr = await fetchFreshQrCode()
	const sessionKey = randomUUID()
	sessions.set(sessionKey, {
		username,
		botname,
		qrcode: qr.qrcode,
		currentApiBaseUrl: DEFAULT_WECHAT_ILINK_BASE,
		startedAt: Date.now(),
		qrRefreshCount: 0,
	})

	return {
		sessionKey,
		qrcodeContent: buildQrCodeUrl(qr.qrcode),
	}
}

/**
 * @param {string} sessionKey 二维码登录会话键。
 * @param {string} username 用户名。
 * @returns {Promise<any>} 扫码会话初始化结果。
 */
export async function pollQrSession(sessionKey, username) {
	purgeExpired()

	const session = sessions.get(sessionKey)
	if (!session || session.username !== username)
		return { done: true, error: 'invalid_or_expired_session' }

	let rawText
	try {
		rawText = await apiGetFetch({
			baseUrl: session.currentApiBaseUrl,
			endpoint: `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(session.qrcode)}`,
			timeoutMs: QR_LONG_POLL_TIMEOUT_MS,
		})
	}
	catch (error) {
		return { done: false, status: 'wait', message: String(error) }
	}

	const status = JSON.parse(rawText)

	switch (status.status) {
		case 'wait':
			return { done: false, status: 'wait' }
		case 'scaned':
			return { done: false, status: 'scaned' }
		case 'scaned_but_redirect': {
			if (status.redirect_host)
				session.currentApiBaseUrl = ensureTrailingSlash(`https://${status.redirect_host}`)
			return { done: false, status: 'scaned_but_redirect' }
		}
		case 'expired': {
			session.qrRefreshCount++
			if (session.qrRefreshCount > MAX_QR_REFRESH) {
				sessions.delete(sessionKey)
				return { done: true, error: 'qr_expired_too_many' }
			}
			const qr = await fetchFreshQrCode()
			session.qrcode = qr.qrcode
			session.startedAt = Date.now()
			session.currentApiBaseUrl = DEFAULT_WECHAT_ILINK_BASE
			return { done: false, status: 'expired', qrcodeContent: buildQrCodeUrl(qr.qrcode) }
		}
		case 'confirmed': {
			if (!status.ilink_bot_id) {
				sessions.delete(sessionKey)
				return { done: true, error: 'missing_ilink_bot_id' }
			}
			if (!status.bot_token) {
				sessions.delete(sessionKey)
				return { done: true, error: 'missing_bot_token' }
			}
			sessions.delete(sessionKey)
			return {
				done: true,
				connected: true,
				token: status.bot_token,
				apiBaseUrl: normalizeServiceBaseUrl(status.baseurl),
				botname: session.botname,
				ilinkUserId: status.ilink_user_id,
			}
		}
		default:
			return { done: false, status: status.status || 'unknown' }
	}
}
