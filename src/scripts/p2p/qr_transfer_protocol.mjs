/**
 * 静态页 `.github/pages/qr-transfer/protocol.mjs` 须与此文件保持逻辑一致（复制同步）。
 * 发送端（主站 Shell）应使用本模块生成房间、密码与密文 envelope。
 */

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
 * @returns {Uint8Array}
 */
export function hexToBytes(hex) {
	const t = String(hex).replace(/^0x/iu, '').trim()
	if (!/^[0-9a-f]{64}$/iu.test(t)) throw new Error(ERR_QR_KEY_FORMAT)
	const out = new Uint8Array(32)
	for (let i = 0; i < 32; i++)
		out[i] = parseInt(t.slice(i * 2, i * 2 + 2), 16)
	return out
}

/**
 * Trystero `joinRoom({ password })` 与 URL 中 AES 密钥的派生约定（双方须一致）。
 * @param {string} hex 64 hex
 * @returns {string}
 */
export function trysteroPasswordFromAesKeyHex(hex) {
	const u8 = hexToBytes(hex)
	let s = ''
	for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i])
	return btoa(s)
}

/** @param {Uint8Array} u8 */
export function u8ToB64(u8) {
	let s = ''
	for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i])
	return btoa(s)
}

/** @param {string} b64 */
export function b64ToU8(b64) {
	const bin = atob(b64)
	const out = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
	return out
}

/**
 * @param {{ iv: string, ct: string }} env base64(iv) + base64(ciphertext+tag)
 * @param {Uint8Array} keyBytes 32 bytes
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
 * @param {string} plaintextUtf8
 * @param {Uint8Array} keyBytes 32 bytes
 * @returns {Promise<{ iv: string, ct: string }>}
 */
export async function encryptCredentialEnvelope(plaintextUtf8, keyBytes) {
	const iv = crypto.getRandomValues(new Uint8Array(12))
	const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt'])
	const pt = new TextEncoder().encode(plaintextUtf8)
	const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pt))
	return { iv: u8ToB64(iv), ct: u8ToB64(ct) }
}

/**
 * @param {string} raw transfer 查询值
 * @returns {string}
 */
export function sanitizeTransferId(raw) {
	const s = decodeURIComponent(String(raw || '').trim())
	if (!/^[\w.-]{1,128}$/.test(s)) throw new Error(ERR_QR_TRANSFER_ID)
	return s
}
