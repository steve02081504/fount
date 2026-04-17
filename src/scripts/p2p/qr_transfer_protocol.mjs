/**
 * 静态页 `.github/pages/chat/qr-transfer/protocol.mjs` 须与此文件保持逻辑一致（复制同步）。
 * 发送端（主站 Shell）应使用本模块生成房间、密码与密文 envelope。
 */

import { b64ToU8, hexToNBytes, u8ToB64 } from './bytes_codec.mjs'

/** @type {string} */
export const QR_TRANSFER_APP_ID = 'fount-qr-transfer'

/** @type {string} Trystero makeAction 类型名（≤32B） */
export const QR_TRANSFER_ACTION = 'credential_transfer'

/** 错误码：密钥格式无效（非 64 位十六进制） */
export const ERR_QR_KEY_FORMAT = 'ERR_QR_KEY_FORMAT'

/** 错误码：迁移 ID 格式无效 */
export const ERR_QR_TRANSFER_ID = 'ERR_QR_TRANSFER_ID'

/**
 * @param {string} transfer 迁移会话 id（仅允许安全字符）
 * @returns {string} Trystero 房间名
 */
export function qrTransferRoomId(transfer) {
	return `fount-qr-${transfer}`
}

/**
 * @param {string} hex 64 位十六进制（32 字节 AES-256 密钥）
 * @returns {Uint8Array} 32 字节密钥
 */
export function hexToBytes(hex) {
	try {
		return hexToNBytes(hex, 32)
	}
	catch {
		throw new Error(ERR_QR_KEY_FORMAT)
	}
}

/**
 * Trystero `joinRoom({ password })` 与 URL 中 AES 密钥的派生约定（双方须一致）。
 *
 * @param {string} hex 64 hex 的 AES-256 密钥
 * @returns {string} 供 Trystero 使用的 base64 口令字符串
 */
export function trysteroPasswordFromAesKeyHex(hex) {
	return u8ToB64(hexToBytes(hex))
}

/**
 *
 */
export { b64ToU8, u8ToB64 } from './bytes_codec.mjs'

/**
 * 解密 AES-GCM 封装的凭据
 *
 * @param {{ iv: string, ct: string }} env base64(iv) + base64(ciphertext+tag)
 * @param {Uint8Array} keyBytes 32 bytes AES 密钥
 * @returns {Promise<string>} UTF-8 明文
 */
export async function decryptCredentialEnvelope(env, keyBytes) {
	const iv = b64ToU8(env.iv)
	const ct = b64ToU8(env.ct)
	const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt'])
	const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
	return new TextDecoder().decode(pt)
}

/**
 * AES-GCM 封装明文为 iv/ct 两段 base64
 *
 * @param {string} plaintextUtf8 UTF-8 明文
 * @param {Uint8Array} keyBytes 32 bytes AES 密钥
 * @returns {Promise<{ iv: string, ct: string }>} iv 与密文+tag 的 base64
 */
export async function encryptCredentialEnvelope(plaintextUtf8, keyBytes) {
	const iv = crypto.getRandomValues(new Uint8Array(12))
	const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt'])
	const pt = new TextEncoder().encode(plaintextUtf8)
	const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pt))
	return { iv: u8ToB64(iv), ct: u8ToB64(ct) }
}

/**
 * 校验并规范化 URL 中的 transfer id
 *
 * @param {string} raw transfer 查询值
 * @returns {string} 通过白名单后的 id
 */
export function sanitizeTransferId(raw) {
	const s = decodeURIComponent(String(raw || '').trim())
	if (!/^[\w.-]{1,128}$/.test(s)) throw new Error(ERR_QR_TRANSFER_ID)
	return s
}
