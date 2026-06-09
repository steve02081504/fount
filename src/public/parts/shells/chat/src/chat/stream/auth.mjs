/**
 * 【文件】stream/auth.mjs
 * 【职责】基于群 GSH 派生密钥的流媒体观看令牌：mint/verify HMAC token，并组装嵌入播放 URL。
 * 【原理】deriveStreamingAuthKey(H, groupId) 得 HMAC 密钥；token 为 sessionId.expiresAt.mac（base64url）。verify 校验过期与 MAC，供 Hub/SFU 侧鉴权观看 VOLATILE 流。
 * 【数据结构】token 三段点分；DEFAULT_TTL_MS 默认 1h。
 * 【关联】file_keys/store.mjs、scripts/p2p/key_crypto.mjs；与 signing 的 stream_chunk 验签互补（观看权 vs 内容完整性）。
 */
import { createHmac, randomBytes } from 'node:crypto'

import { deriveStreamingAuthKey } from '../../../../../../../scripts/p2p/key_crypto.mjs'

const DEFAULT_TTL_MS = 3_600_000

/**
 * @param {string} H 群 GSH（hex）
 * @param {string} groupId 群 ID
 * @returns {Buffer} HMAC 密钥材料
 */
function streamingHmacSecret(H, groupId) {
	if (!H) throw new Error('Group encryption (GSH) required for streaming auth')
	return deriveStreamingAuthKey(H, groupId)
}

/**
 * 为本节点观众签发短时流媒体观看令牌（opaque HMAC，密钥来自群 GSH）。
 * @param {string} username 观看者
 * @param {string} groupId 群 ID
 * @param {string} channelId 流媒体频道 ID
 * @param {number} [ttlMs] 有效期毫秒
 * @param {string} H 群 GSH hex
 * @returns {{ sessionId: string, token: string, expiresAt: number }} 会话 id、opaque 令牌与过期时间戳
 */
export function mintStreamingViewToken(username, groupId, channelId, ttlMs = DEFAULT_TTL_MS, H) {
	const expiresAt = Date.now() + Math.max(60_000, ttlMs)
	const sessionId = randomBytes(12).toString('hex')
	const body = `${username}\0${groupId}\0${channelId}\0${sessionId}\0${expiresAt}`
	const mac = createHmac('sha256', streamingHmacSecret(H, groupId)).update(body).digest('base64url')
	const token = `${sessionId}.${expiresAt}.${mac}`
	return { sessionId, token, expiresAt }
}

/**
 * @param {string} token mint 返回值
 * @param {string} username 当前用户
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string | null} [H] 群 GSH hex
 * @returns {boolean} 是否在有效期内且签名正确
 */
export function verifyStreamingViewToken(token, username, groupId, channelId, H = null) {
	if (!H || !token) return false
	const parts = token.split('.')
	if (parts.length !== 3) return false
	const [sessionId, expStr, mac] = parts
	const expiresAt = Number(expStr)
	if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false
	const body = `${username}\0${groupId}\0${channelId}\0${sessionId}\0${expiresAt}`
	const expect = createHmac('sha256', streamingHmacSecret(H, groupId)).update(body).digest('base64url')
	return mac === expect
}

/**
 * 群设置中的 SFU 地址规范化：`wss://` → `https://`，`ws://` → `http://`。
 * @param {string} baseUrl 原始 URL
 * @returns {string} 可嵌入 iframe 的基址
 */
export function normalizeStreamingBaseUrl(baseUrl) {
	const u = String(baseUrl || '').trim()
	if (!u) return ''
	if (u.startsWith('wss://')) return `https://${u.slice(6)}`
	if (u.startsWith('ws://')) return `http://${u.slice(5)}`
	return u
}

/**
 * 将 token 拼入 SFU 嵌入 URL 查询串。
 * @param {string} baseUrl 群设置中的观看页 URL
 * @param {string} token 观看令牌
 * @returns {string} 可嵌入 iframe 的 URL
 */
export function buildStreamingEmbedUrl(baseUrl, token) {
	const u = normalizeStreamingBaseUrl(baseUrl)
	if (!u) return ''
	try {
		const url = new URL(u)
		url.searchParams.set('fount_token', token)
		return url.toString()
	}
	catch {
		return u.includes('?') ? `${u}&fount_token=${encodeURIComponent(token)}` : `${u}?fount_token=${encodeURIComponent(token)}`
	}
}
