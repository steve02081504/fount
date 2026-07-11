/**
 * Domain-key 信封：X25519 ECIES 包装与 AES-GCM 消息载荷（wire scheme 由消费方定义，如 ckg）。
 * 解密 payload 不可脱离外层 DAG Ed25519 签名上下文单独传递或信任。
 */
import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

import { unwrapKeyEcies, wrapKeyEcies } from './key_crypto.mjs'

/** @type {'ckg'} 频道消息 content 加密 scheme */
export const CKG_SCHEME = 'ckg'

/** @typedef {{ ephemPub: string, iv: string, ciphertext: string, authTag: string }} EciesWrapBlob */

/**
 * 生成随机 32 字节频道密钥（hex）。
 * @returns {string} 32 字节 hex 频道密钥
 */
export function generateChannelKey() {
	return randomBytes(32).toString('hex')
}

/**
 * X25519 ECIES 包装 K_ch 给成员 Ed25519 公钥。
 * @param {string} channelKeyHex 32 字节 hex
 * @param {string} memberEdPubKeyHex 64 hex
 * @returns {EciesWrapBlob} ECIES 包装结果
 */
export function wrapChannelKey(channelKeyHex, memberEdPubKeyHex) {
	return wrapKeyEcies(channelKeyHex, memberEdPubKeyHex)
}

/**
 * @param {EciesWrapBlob} wrap ECIES 密文
 * @param {Uint8Array} myEdPrivKeySeed 32 字节 Ed25519 种子
 * @returns {string | null} K_ch hex
 */
export function unwrapChannelKey(wrap, myEdPrivKeySeed) {
	return unwrapKeyEcies(wrap, myEdPrivKeySeed)
}

/**
 * @param {string} channelKeyHex K_ch
 * @param {string} channelId 频道 id（AAD 盐）
 * @param {number} generation 代际
 * @returns {Buffer} 消息 AES-256 密钥
 */
function messageAesKey(channelKeyHex, channelId, generation) {
	return Buffer.from(hkdfSync(
		'sha256',
		Buffer.from(channelKeyHex, 'hex'),
		`ckg:${String(channelId)}:${String(generation)}`,
		'',
		32,
	))
}

/**
 * @param {string} plaintext UTF-8 / JSON 字符串
 * @param {string} channelKeyHex K_ch
 * @param {string} channelId 频道 ID
 * @param {number} generation 密钥代际
 * @returns {{ scheme: typeof CKG_SCHEME, channelId: string, generation: number, payload: string }} 频道密钥信封
 */
export function encryptWithChannelKey(plaintext, channelKeyHex, channelId, generation) {
	const key = messageAesKey(channelKeyHex, channelId, generation)
	const iv = randomBytes(12)
	const cipher = createCipheriv('aes-256-gcm', key, iv)
	const plain = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8')
	const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()])
	const authTag = cipher.getAuthTag()
	return {
		scheme: CKG_SCHEME,
		channelId: String(channelId),
		generation: Number(generation) || 0,
		payload: `${iv.toString('base64')}.${ciphertext.toString('base64')}.${authTag.toString('base64')}`,
	}
}

/**
 * @param {{ scheme?: string, channelId?: string, generation?: number, payload: string }} envelope 频道密钥信封
 * @param {string} channelKeyHex K_ch
 * @param {string} channelId 频道 ID
 * @returns {string | null} 明文 UTF-8
 */
export function decryptWithChannelKey(envelope, channelKeyHex, channelId) {
	if (envelope?.scheme !== CKG_SCHEME || !envelope.payload) return null
	try {
		const parts = envelope.payload.split('.')
		if (parts.length !== 3) return null
		const generation = Number(envelope.generation) || 0
		const key = messageAesKey(channelKeyHex, channelId, generation)
		const iv = Buffer.from(parts[0], 'base64')
		const ciphertext = Buffer.from(parts[1], 'base64')
		const authTag = Buffer.from(parts[2], 'base64')
		const decipher = createDecipheriv('aes-256-gcm', key, iv)
		decipher.setAuthTag(authTag)
		return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
	}
	catch { return null }
}
