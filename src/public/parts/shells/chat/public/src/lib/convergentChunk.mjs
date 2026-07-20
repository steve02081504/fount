/**
 * 浏览器端收敛块哈希（与 `npm:@steve02081504/fount-p2p/crypto/key` `encryptConvergentPlaintext` 对齐）。
 */

import { sha256Hex } from '../../shared/digest.mjs'

/**
 * @param {string} contentHashHex 明文 contentHash
 * @returns {Promise<Uint8Array>} 32 字节 contentKey
 */
async function deriveContentKey(contentHashHex) {
	const keyMaterial = Uint8Array.from(
		contentHashHex.match(/.{2}/gu).map(byte => parseInt(byte, 16)),
	)
	const importKey = await crypto.subtle.importKey(
		'raw',
		keyMaterial,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	)
	const contentKey = await crypto.subtle.sign('HMAC', importKey, new TextEncoder().encode('ce\x00'))
	return new Uint8Array(contentKey)
}

/**
 * @param {ArrayBuffer | Uint8Array} plainBuffer 明文字节
 * @returns {Promise<{ contentHash: string, ciphertextHash: string }>} 收敛哈希
 */
export async function convergentChunkHashes(plainBuffer) {
	const plain = plainBuffer instanceof Uint8Array ? plainBuffer : new Uint8Array(plainBuffer)
	const contentHash = await sha256Hex(plain)
	const contentKey = await deriveContentKey(contentHash)
	const iv = Uint8Array.from(contentHash.match(/.{2}/gu).slice(0, 12).map(byte => parseInt(byte, 16)))
	const cryptoKey = await crypto.subtle.importKey('raw', contentKey, { name: 'AES-GCM' }, false, ['encrypt'])
	const encrypted = new Uint8Array(await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv, tagLength: 128 },
		cryptoKey,
		plain,
	))
	const authTag = encrypted.slice(-16)
	const ciphertext = encrypted.slice(0, -16)
	const raw = new Uint8Array(12 + 16 + ciphertext.length)
	raw.set(iv, 0)
	raw.set(authTag, 12)
	raw.set(ciphertext, 28)
	const ciphertextHash = await sha256Hex(raw)
	return { contentHash, ciphertextHash }
}
