import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import * as ed from 'npm:@noble/ed25519'

/**
 * 由种子字节派生 Ed25519 密钥对
 *
 * @param {Uint8Array|Buffer} seed 任意长度；非 32 字节时 sha256 派生
 * @returns {{ publicKey: Uint8Array, secretKey: Uint8Array }} 32 字节私钥与对应公钥
 */
export function keyPairFromSeed(seed) {
	const u = seed instanceof Uint8Array ? seed : new Uint8Array(seed)
	const sk = u.length === 32 ? u : new Uint8Array(createHash('sha256').update(u).digest())
	return { publicKey: ed.getPublicKey(sk), secretKey: sk }
}

/**
 * 随机生成 Ed25519 密钥对
 *
 * @returns {Promise<{ publicKey: Uint8Array, secretKey: Uint8Array }>} 随机生成的 Ed25519 密钥对
 */
export async function randomKeyPair() {
	const sk = ed.utils.randomPrivateKey()
	return { publicKey: ed.getPublicKey(sk), secretKey: sk }
}

/**
 * Ed25519 签名
 *
 * @param {Uint8Array} message 待签名消息字节
 * @param {Uint8Array} secretKey 私钥（取前 32 字节为种子）
 * @returns {Promise<Uint8Array>} 64 字节签名
 */
export async function sign(message, secretKey) {
	return ed.sign(message, secretKey.slice(0, 32))
}

/**
 * 校验 Ed25519 签名
 *
 * @param {Uint8Array} signature 64 字节签名
 * @param {Uint8Array} message 原始消息字节
 * @param {Uint8Array} publicKey 公钥
 * @returns {Promise<boolean>} 合法为 true；异常或失败为 false
 */
export async function verify(signature, message, publicKey) {
	try {
		return ed.verify(signature, message, publicKey)
	}
	catch {
		return false
	}
}

/**
 * 公钥的 sha256 十六进制指纹（小写、无 0x 前缀）
 *
 * @param {Uint8Array} publicKey Ed25519 公钥字节
 * @returns {string} 64 字符 hex
 */
export function pubKeyHash(publicKey) {
	return bufferToHexSimple(hashPubKeyBytes(publicKey))
}

/**
 * 公钥 sha256 摘要
 *
 * @param {Uint8Array} publicKey Ed25519 公钥字节
 * @returns {Buffer} 32 字节 digest
 */
function hashPubKeyBytes(publicKey) {
	return createHash('sha256').update(publicKey).digest()
}

/**
 * Buffer / Uint8Array → 小写 hex 字符串
 *
 * @param {Uint8Array|Buffer} buf 二进制缓冲
 * @returns {string} 小写十六进制文本
 */
function bufferToHexSimple(buf) {
	return Buffer.from(buf).toString('hex')
}

/**
 *
 */
export {
	arrayBufferToBase64,
	b64ToU8,
	hexToNBytes,
	u8ToB64,
} from './bytes_codec.mjs'
