import { Buffer } from 'node:buffer'
import {
	createHash,
	createPrivateKey,
	createPublicKey,
	randomBytes,
	sign as nodeSign,
	verify as nodeVerify,
} from 'node:crypto'

/** 固定 DER 头（非秘密），让 Node 把 32 字节种子当成私钥 */
const PKCS8_RAW_SEED_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')
/** 固定 DER 头（非秘密），让 Node 把 32 字节当成公钥 */
const SPKI_RAW_PUB_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

/**
 * @param {Uint8Array|Buffer} seed32 32 字节私钥种子
 * @returns {import('node:crypto').KeyObject} Node 私钥对象
 */
function privateKeyFromSeed(seed32) {
	return createPrivateKey({
		key: Buffer.concat([PKCS8_RAW_SEED_PREFIX, Buffer.from(seed32).subarray(0, 32)]),
		format: 'der',
		type: 'pkcs8',
	})
}

/**
 * @param {Uint8Array|Buffer} rawPublicKey 32 字节公钥
 * @returns {import('node:crypto').KeyObject} Node 公钥对象
 */
function publicKeyFromRaw(rawPublicKey) {
	return createPublicKey({
		key: Buffer.concat([SPKI_RAW_PUB_PREFIX, Buffer.from(rawPublicKey).subarray(0, 32)]),
		format: 'der',
		type: 'spki',
	})
}

/**
 * @param {Uint8Array|Buffer} seed32 32 字节私钥种子
 * @returns {Uint8Array} 32 字节公钥
 */
function rawPublicKeyFromSeed(seed32) {
	const der = createPublicKey(privateKeyFromSeed(seed32)).export({ type: 'spki', format: 'der' })
	return new Uint8Array(der.subarray(-32))
}

/**
 * 由种子字节派生密钥对
 *
 * @param {Uint8Array|Buffer} seed 任意长度；非 32 字节时 sha256 派生
 * @returns {{ publicKey: Uint8Array, secretKey: Uint8Array }} 32 字节私钥与对应公钥
 */
export function keyPairFromSeed(seed) {
	const u = seed instanceof Uint8Array ? seed : new Uint8Array(seed)
	const sk = u.length === 32 ? u : new Uint8Array(createHash('sha256').update(u).digest())
	return { publicKey: rawPublicKeyFromSeed(sk), secretKey: new Uint8Array(sk) }
}

/**
 * 随机生成密钥对
 *
 * @returns {Promise<{ publicKey: Uint8Array, secretKey: Uint8Array }>} 随机密钥对
 */
export async function randomKeyPair() {
	const sk = randomBytes(32)
	return keyPairFromSeed(sk)
}

/**
 * 由 32 字节私钥种子导出对应公钥
 * @param {Uint8Array} secretKey 私钥种子
 * @returns {Uint8Array} 公钥
 */
export function publicKeyFromSeed(secretKey) {
	return rawPublicKeyFromSeed(secretKey)
}

/**
 * 签名
 *
 * @param {Uint8Array} message 待签名消息字节
 * @param {Uint8Array} secretKey 私钥（取前 32 字节为种子）
 * @returns {Promise<Uint8Array>} 64 字节签名
 */
export async function sign(message, secretKey) {
	const sig = nodeSign(null, Buffer.from(message), privateKeyFromSeed(secretKey))
	return new Uint8Array(sig)
}

/**
 * 校验签名
 *
 * @param {Uint8Array} signature 64 字节签名
 * @param {Uint8Array} message 原始消息字节
 * @param {Uint8Array} publicKey 公钥
 * @returns {Promise<boolean>} 合法为 true；异常或失败为 false
 */
export async function verify(signature, message, publicKey) {
	try {
		return nodeVerify(null, Buffer.from(message), publicKeyFromRaw(publicKey), Buffer.from(signature))
	}
	catch {
		return false
	}
}

/**
 * 公钥的 sha256 十六进制指纹（小写、无 0x 前缀）
 *
 * @param {Uint8Array} publicKey 公钥字节
 * @returns {string} 64 字符 hex
 */
export function pubKeyHash(publicKey) {
	return bufferToHexSimple(hashPubKeyBytes(publicKey))
}

/**
 * 公钥 sha256 摘要
 *
 * @param {Uint8Array} publicKey 公钥字节
 * @returns {Buffer} 32 字节 digest
 */
function hashPubKeyBytes(publicKey) {
	return createHash('sha256').update(publicKey).digest()
}

/**
 * 任意输入的 SHA-256 十六进制（小写、无 0x 前缀）。
 *
 * @param {Uint8Array|Buffer|string} data 字节或 UTF-8 文本
 * @returns {string} 64 字符 hex
 */
export function sha256Hex(data) {
	const input = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data)
	return createHash('sha256').update(input).digest('hex')
}

/**
 * UTF-8 文本 SHA-256 十六进制（小写、无 0x 前缀）。
 *
 * @param {string} text 文本
 * @returns {string} 64 字符 hex
 */
export function sha256TextHex(text) {
	return sha256Hex(String(text ?? ''))
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
