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
		`cabinet-operation:${cabinetId}:${generation}`,
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
export function encryptOperationPayload(payload, readKeyHex, cabinetId, generation) {
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
export function decryptOperationPayload(envelope, readKeyHex, cabinetId, generation) {
	if (!envelope?.iv || !envelope?.ciphertext || !envelope?.authTag) return null
	try {
		const key = payloadAesKey(readKeyHex, cabinetId, generation)
		const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
		decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'))
		return JSON.parse(Buffer.concat([
			decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
			decipher.final(),
		]).toString('utf8'))
	}
	catch {
		return null
	}
}

/**
 * @param {object} operation 未签名操作（不含 sig）
 * @returns {Uint8Array} 签名字节
 */
export function operationSignBytes(operation) {
	return Buffer.from(JSON.stringify({
		operation_id: operation.operation_id,
		hlc: operation.hlc,
		gen: operation.gen,
		entry_id: operation.entry_id,
		action: operation.action,
		payload_ciphertext: operation.payload_ciphertext,
	}), 'utf8')
}

/**
 * @param {object} operation 未签名操作
 * @param {Uint8Array} writeSecretKey 写私钥种子
 * @returns {Promise<object>} 带 sig 的操作
 */
export async function signOperation(operation, writeSecretKey) {
	return {
		...operation,
		sig: Buffer.from(await sign(operationSignBytes(operation), writeSecretKey)).toString('hex'),
	}
}

/**
 * @param {object} operation 带 sig 的操作
 * @param {Uint8Array | string} writePublicKey 写公钥（32B 或 64 hex）
 * @returns {Promise<boolean>} 验签结果
 */
export async function verifyOperation(operation, writePublicKey) {
	if (!operation?.sig) return false
	const publicKey = typeof writePublicKey === 'string'
		? Buffer.from(writePublicKey, 'hex')
		: writePublicKey
	return verify(Buffer.from(operation.sig, 'hex'), operationSignBytes(operation), publicKey)
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
