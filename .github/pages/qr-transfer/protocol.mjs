/**
 * 镜像自 `src/scripts/p2p/qr_transfer_protocol.mjs` — 修改时请同步两处。
 */

/** @type {string} */
export const QR_TRANSFER_APP_ID = 'fount-qr-transfer'

/** @type {string} */
export const QR_TRANSFER_ACTION = 'credential_transfer'

/** 错误码：密钥格式无效（非 64 位十六进制） */
export const ERR_QR_KEY_FORMAT = 'ERR_QR_KEY_FORMAT'

/** 错误码：迁移 ID 格式无效 */
export const ERR_QR_TRANSFER_ID = 'ERR_QR_TRANSFER_ID'

/**
 * @param {string} transfer
 * @returns {string}
 */
export function qrTransferRoomId(transfer) {
	return `fount-qr-${transfer}`
}

/**
 * @param {string} hex
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
 * @param {string} hex
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
 * @param {{ iv: string, ct: string }} env
 * @param {Uint8Array} keyBytes
 * @returns {Promise<string>}
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
 * @param {Uint8Array} keyBytes
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
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeTransferId(raw) {
	const s = decodeURIComponent(String(raw || '').trim())
	if (!/^[\w.-]{1,128}$/.test(s)) throw new Error(ERR_QR_TRANSFER_ID)
	return s
}
