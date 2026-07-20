import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto'

import { pubKeyHash, publicKeyFromSeed, sign, verify } from 'npm:@steve02081504/fount-p2p/crypto'

/**
 * @param {string} readKeyHex 32 字节 hex 读密钥
 * @param {string} cabinetId 柜 id
 * @param {number} generation 代际
 * @returns {Buffer} AES-256 密钥
 */
function payloadAesKey(readKeyHex, cabinetId, generation) {
	return Buffer.from(hkdfSync(
		'sha256',
		Buffer.from(readKeyHex, 'hex'),
		`cabinet-op:${String(cabinetId)}:${String(generation)}`,
		'',
		32,
	))
}

/**
 * @param {object} payload 明文对象
 * @param {string} readKeyHex 读密钥 hex
 * @param {string} cabinetId 柜
 * @param {number} generation 代际
 * @returns {{ iv: string, ciphertext: string, authTag: string }} 密文信封
 */
export function encryptOpPayload(payload, readKeyHex, cabinetId, generation) {
	const key = payloadAesKey(readKeyHex, cabinetId, generation)
	const iv = randomBytes(12)
	const cipher = createCipheriv('aes-256-gcm', key, iv)
	const ciphertext = Buffer.concat([
		cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
		cipher.final(),
	])
	return {
		iv: iv.toString('base64'),
		ciphertext: ciphertext.toString('base64'),
		authTag: cipher.getAuthTag().toString('base64'),
	}
}

/**
 * @param {{ iv: string, ciphertext: string, authTag: string }} envelope 密文
 * @param {string} readKeyHex 读密钥
 * @param {string} cabinetId 柜
 * @param {number} generation 代际
 * @returns {object | null} 明文
 */
export function decryptOpPayload(envelope, readKeyHex, cabinetId, generation) {
	if (!envelope?.iv || !envelope?.ciphertext || !envelope?.authTag) return null
	try {
		const key = payloadAesKey(readKeyHex, cabinetId, generation)
		const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
		decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'))
		const plain = Buffer.concat([
			decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
			decipher.final(),
		]).toString('utf8')
		return JSON.parse(plain)
	}
	catch {
		return null
	}
}

/**
 * @param {object} op 未签名 op（不含 sig）
 * @returns {Uint8Array} 签名字节
 */
export function opSignBytes(op) {
	const canonical = JSON.stringify({
		op_id: op.op_id,
		hlc: op.hlc,
		gen: op.gen,
		entry_id: op.entry_id,
		action: op.action,
		payload_ciphertext: op.payload_ciphertext,
	})
	return Buffer.from(canonical, 'utf8')
}

/**
 * @param {object} op 未签名 op
 * @param {Uint8Array} writeSecretKey 写私钥种子
 * @returns {Promise<object>} 带 sig 的 op
 */
export async function signOp(op, writeSecretKey) {
	const sig = await sign(opSignBytes(op), writeSecretKey)
	return { ...op, sig: Buffer.from(sig).toString('hex') }
}

/**
 * @param {object} op 带 sig 的 op
 * @param {Uint8Array | string} writePublicKey 写公钥（32B 或 64 hex）
 * @returns {Promise<boolean>} 验签结果
 */
export async function verifyOp(op, writePublicKey) {
	if (!op?.sig) return false
	const pub = typeof writePublicKey === 'string'
		? Buffer.from(writePublicKey, 'hex')
		: writePublicKey
	return verify(Buffer.from(op.sig, 'hex'), opSignBytes(op), pub)
}

/**
 * @param {Uint8Array} writePublicKey 写公钥
 * @returns {string} cabinet_id = pubKeyHash
 */
export function cabinetIdFromWritePub(writePublicKey) {
	return pubKeyHash(writePublicKey)
}

/**
 * @param {Uint8Array} writeSecretKey 写私钥种子
 * @returns {{ publicKey: Uint8Array, cabinetId: string }} 公钥与 id
 */
export function writeIdentityFromSecret(writeSecretKey) {
	const publicKey = publicKeyFromSeed(writeSecretKey)
	return { publicKey, cabinetId: cabinetIdFromWritePub(publicKey) }
}

/**
 * @param {string} text 任意文本
 * @returns {string} sha256 hex
 */
export function sha256Hex(text) {
	return createHash('sha256').update(text).digest('hex')
}
