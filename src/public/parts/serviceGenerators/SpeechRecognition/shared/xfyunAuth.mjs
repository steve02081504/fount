/**
 * 讯飞类鉴权辅助。
 */
import { createHash, createHmac } from 'node:crypto'

/**
 * HMAC-SHA256 后 Base64。
 * @param {string} secret 密钥
 * @param {string} data 原文
 * @returns {string} 签名
 */
export function hmacSha256Base64(secret, data) {
	return createHmac('sha256', secret).update(data).digest('base64')
}

/**
 * HMAC-SHA1 后 Base64。
 * @param {string | Buffer} secret 密钥
 * @param {string | Buffer} data 原文
 * @returns {string} 签名
 */
export function hmacSha1Base64(secret, data) {
	return createHmac('sha1', secret).update(data).digest('base64')
}

/**
 * MD5 hex。
 * @param {string} data 原文
 * @returns {string} hex
 */
export function md5Hex(data) {
	return createHash('md5').update(data).digest('hex')
}

/**
 * SHA-256 Base64（body digest）。
 * @param {string | Uint8Array} body 正文
 * @returns {string} digest
 */
export function sha256Base64(body) {
	return createHash('sha256').update(body).digest('base64')
}

/**
 * 讯飞开放平台 WS URL（host/date/request-line HMAC-SHA256）。
 * @param {{ host: string, path: string, apiKey: string, apiSecret: string }} opts 参数
 * @returns {string} wss URL
 */
export function buildXfyunHmacSha256WsUrl({ host, path, apiKey, apiSecret }) {
	const date = new Date().toUTCString()
	const signOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`
	const signature = hmacSha256Base64(apiSecret, signOrigin)
	const authOrigin = `api_key="${apiKey}",algorithm="hmac-sha256",headers="host date request-line",signature="${signature}"`
	const authorization = btoa(authOrigin)
	const q = new URLSearchParams({ authorization, date, host })
	return `wss://${host}${path}?${q}`
}

/**
 * 按 key 排序后 URL 编码拼接，再 HMAC-SHA1。
 * @param {Record<string, string>} params 参数
 * @param {string} secret 密钥
 * @returns {string} signature
 */
export function signSortedParamsHmacSha1(params, secret) {
	const parts = Object.keys(params).sort().map(k =>
		`${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`
	)
	return hmacSha1Base64(secret, parts.join('&'))
}

/**
 * 东八区墙钟时间串 YYYY-MM-DDTHH:mm:ss+0800（RTASR 办公版）。
 * @returns {string} 时间串
 */
export function formatUtcPlus8() {
	const d = new Date(Date.now() + 8 * 3600 * 1000)
	/**
	 * 补零到两位。
	 * @param {number} n 数字
	 * @returns {string} 两位数字串
	 */
	const pad = n => String(n).padStart(2, '0')
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+0800`
}
