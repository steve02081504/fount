/**
 * GSH（Group Secret Hash）统一加密方案（§11）
 *
 * H 是 32 字节随机群秘密哈希，存储在本节点 `gsh.json`。
 * 所有消息/文件密钥均由 H 通过 HMAC-SHA256 推导，无需每成员单独分发密钥。
 *
 * 禁止：mailbox-ECDH、Megolm、Sender-Keys、encrypted_mailbox_batch。
 */

import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'

import { x25519 } from 'npm:@noble/curves/ed25519.js'

// ─── KDF ──────────────────────────────────────────────────────────────────────

/**
 * HMAC-SHA256(key=H, data=label + "\x00" + id) → 32 字节 AES-256 密钥
 * @param {Buffer} H 32 字节群秘密
 * @param {string} label 用途标签（"broadcast" / "file" / "dm"）
 * @param {string} id channelId / fileId 等
 * @returns {Buffer} 32 字节派生密钥
 */
function kdf(H, label, id) {
	return createHmac('sha256', H)
		.update(label)
		.update('\x00')
		.update(id)
		.digest()
}

/**
 * 从十六进制 H 字符串或 Buffer 中安全取出 Buffer。
 * @param {string | Buffer | Uint8Array} H 群秘密（hex 字符串或字节）
 * @returns {Buffer} 32 字节 Buffer
 */
function toHBuf(H) {
	if (typeof H === 'string') return Buffer.from(H, 'hex')
	return Buffer.from(H)
}

// ─── 密钥推导 ─────────────────────────────────────────────────────────────────

/**
 * 推导广播频道消息加密密钥：`KDF(H, "broadcast", channelId)`（§11.1）
 * @param {string | Buffer} H 群秘密（hex 或 Buffer）
 * @param {string} channelId 频道 ID
 * @returns {Buffer} 32 字节 AES-256 密钥
 */
export function deriveChannelKey(H, channelId) {
	return kdf(toHBuf(H), 'broadcast', String(channelId))
}

/**
 * 推导群内两两直连额外隔离密钥：`KDF(H, "dm", sorted(a,b).join(":"))`（§11.1）
 * @param {string | Buffer} H 群秘密
 * @param {string} pubKeyHashA 第一方 pubKeyHash
 * @param {string} pubKeyHashB 第二方 pubKeyHash
 * @returns {Buffer} 32 字节 AES-256 密钥
 */
export function derivePairKey(H, pubKeyHashA, pubKeyHashB) {
	const sorted = [pubKeyHashA, pubKeyHashB].sort().join(':')
	return kdf(toHBuf(H), 'dm', sorted)
}

/**
 * 推导群文件加密密钥：`KDF(H, "file", fileId)`（§10.3、§6.3）
 * @param {string | Buffer} H 群秘密
 * @param {string} fileId 文件 ID
 * @returns {Buffer} 32 字节 AES-256 密钥
 */
export function deriveFileKey(H, fileId) {
	return kdf(toHBuf(H), 'file', String(fileId))
}

// ─── H 轮换（§11.2、§6.3 key_rotate）──────────────────────────────────────

/**
 * 踢人/主动轮换后推导新 H：`H_new = SHA256(H_old || eventId || nonce)`（§11.2）
 *
 * @param {string} H_old_hex 旧 H（十六进制）
 * @param {string} eventId 踢人/轮换事件 ID（签名后的 SHA256 hex）
 * @param {string} nonce `new_H_nonce` 字段（字符串）
 * @returns {string} 新 H（十六进制）
 */
export function deriveNewH(H_old_hex, eventId, nonce) {
	return createHash('sha256')
		.update(Buffer.from(H_old_hex, 'hex'))
		.update(String(eventId))
		.update(String(nonce))
		.digest('hex')
}

/**
 * 生成随机 H（32 字节，十六进制），用于群初始化或手动重置。
 * @returns {string} 随机 H（hex）
 */
export function generateH() {
	return randomBytes(32).toString('hex')
}

/**
 * 生成随机 `new_H_nonce`，用于踢人事件或 key_rotate 事件。
 * @returns {string} 16 字节 base64 随机 nonce
 */
export function generateHNonce() {
	return randomBytes(16).toString('base64')
}

// ─── Ed25519 → X25519 互转（内部用）────────────────────────────────────────

const P25519 = (1n << 255n) - 19n

/**
 * 费马小定理求模逆元（要求模数为素数）。
 * @param {bigint} a 被求逆的整数
 * @param {bigint} m 模数（必须为素数）
 * @returns {bigint} a 在模 m 下的逆元
 */
function modInv(a, m) {
	let result = 1n
	let base = ((a % m) + m) % m
	let exp = m - 2n
	while (exp > 0n) {
		if (exp & 1n) result = result * base % m
		base = base * base % m
		exp >>= 1n
	}
	return result
}

/**
 * Ed25519 公钥（Edwards y 坐标）→ X25519 公钥（Montgomery u 坐标）。
 * @param {Uint8Array} edPub Ed25519 公钥（32 字节，Edwards 曲线 y 坐标，小端序）
 * @returns {Uint8Array} 32 字节 X25519 公钥（Montgomery u 坐标，小端序）
 */
function edPubToX25519(edPub) {
	const yCopy = new Uint8Array(edPub)
	yCopy[31] &= 0x7f
	let y = 0n
	for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(yCopy[i])
	const u = (1n + y) * modInv(1n - y + P25519, P25519) % P25519
	const result = new Uint8Array(32)
	let tmp = u
	for (let i = 0; i < 32; i++) { result[i] = Number(tmp & 0xffn); tmp >>= 8n }
	return result
}

/**
 * Ed25519 私钥种子（32 字节）→ X25519 私钥（RFC 7748 §4.1）。
 * @param {Uint8Array} seed Ed25519 私钥种子（32 字节）
 * @returns {Uint8Array} X25519 私钥（32 字节，已 clamp）
 */
function edPrivToX25519(seed) {
	const hash = createHash('sha512').update(seed).digest()
	const key = new Uint8Array(32)
	for (let i = 0; i < 32; i++) key[i] = hash[i]
	key[0] &= 248; key[31] &= 127; key[31] |= 64
	return key
}

// ─── H 分发（§11.1、§6.3 peer_invite）──────────────────────────────────────

/**
 * 为新成员加密当前 H（O(1) 分发，§11.1）。
 *
 * 使用临时 X25519 密钥对 + ECDH（ECIES 模式），ephemeral key 保证 forward secrecy。
 * wrapKey = SHA256(sharedSecret)；iv 随机生成。
 *
 * @param {string} H_hex 当前群秘密（hex）
 * @param {string} memberEdPubKeyHex 新成员 Ed25519 公钥（hex，64字符）
 * @returns {{ ephemPub: string, iv: string, ciphertext: string, authTag: string }} ECIES 加密结果（ephemPub + AES-GCM 密文）
 */
export function encryptHForMember(H_hex, memberEdPubKeyHex) {
	const memberX25519Pub = edPubToX25519(Buffer.from(memberEdPubKeyHex, 'hex'))
	const ephemPriv = x25519.utils.randomPrivateKey()
	const ephemPub = x25519.getPublicKey(ephemPriv)
	const sharedSecret = x25519.getSharedSecret(ephemPriv, memberX25519Pub)
	const wrapKey = createHash('sha256').update(sharedSecret).digest()
	const iv = randomBytes(12)
	const cipher = createCipheriv('aes-256-gcm', wrapKey, iv)
	const H_bytes = Buffer.from(H_hex, 'hex')
	const ciphertext = Buffer.concat([cipher.update(H_bytes), cipher.final()])
	const authTag = cipher.getAuthTag()
	return {
		ephemPub: Buffer.from(ephemPub).toString('base64'),
		iv: iv.toString('base64'),
		ciphertext: ciphertext.toString('base64'),
		authTag: authTag.toString('base64'),
	}
}

/**
 * 用本节点 Ed25519 私钥种子解密 `peer_invite` 中的 `encrypted_H`（§11.1）。
 *
 * @param {{ ephemPub: string, iv: string, ciphertext: string, authTag: string }} encryptedH `encryptHForMember` 的输出对象
 * @param {Uint8Array} myEdPrivKeySeed 32 字节私钥种子
 * @returns {string | null} 解密后的 H（hex）；失败返回 null
 */
export function decryptH(encryptedH, myEdPrivKeySeed) {
	try {
		const myX25519Priv = edPrivToX25519(myEdPrivKeySeed)
		const ephemPub = Buffer.from(encryptedH.ephemPub, 'base64')
		const sharedSecret = x25519.getSharedSecret(myX25519Priv, ephemPub)
		const wrapKey = createHash('sha256').update(sharedSecret).digest()
		const iv = Buffer.from(encryptedH.iv, 'base64')
		const ciphertext = Buffer.from(encryptedH.ciphertext, 'base64')
		const authTag = Buffer.from(encryptedH.authTag, 'base64')
		const decipher = createDecipheriv('aes-256-gcm', wrapKey, iv)
		decipher.setAuthTag(authTag)
		return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('hex')
	}
	catch { return null }
}

// ─── 消息加密（§11.1 broadcast）──────────────────────────────────────────────

/**
 * 用 GSH 广播密钥加密消息内容（§11.1，`K = KDF(H, "broadcast", channelId)`）。
 *
 * @param {string} plaintext 明文消息
 * @param {string | Buffer} H 群秘密
 * @param {string} channelId 频道 ID
 * @param {number} generation 当前 H 代数（写入密文头，供接收方按代数查找 H）
 * @returns {{ scheme: 'gsh', generation: number, iv: string, ciphertext: string, authTag: string }} AES-256-GCM 加密结果，含 scheme 标识与 generation
 */
export function encryptMessage(plaintext, H, channelId, generation) {
	const key = deriveChannelKey(H, channelId)
	const iv = randomBytes(12)
	const cipher = createCipheriv('aes-256-gcm', key, iv)
	const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
	const authTag = cipher.getAuthTag()
	return {
		scheme: 'gsh',
		generation: Math.floor(generation),
		iv: iv.toString('base64'),
		ciphertext: ciphertext.toString('base64'),
		authTag: authTag.toString('base64'),
	}
}

/**
 * 解密 GSH 广播消息。
 *
 * @param {{ scheme: string, iv: string, ciphertext: string, authTag: string }} stored `encryptMessage` 的输出；若 `scheme` 不是 `'gsh'` 则返回 null
 * @param {string | Buffer} H 对应 generation 的群秘密
 * @param {string} channelId 频道 ID
 * @returns {string | null} 明文；解密失败或无权限返回 null
 */
export function decryptMessage(stored, H, channelId) {
	if (!stored || stored.scheme !== 'gsh') return null
	try {
		const key = deriveChannelKey(H, channelId)
		const iv = Buffer.from(stored.iv, 'base64')
		const ciphertext = Buffer.from(stored.ciphertext, 'base64')
		const authTag = Buffer.from(stored.authTag, 'base64')
		const decipher = createDecipheriv('aes-256-gcm', key, iv)
		decipher.setAuthTag(authTag)
		return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
	}
	catch { return null }
}

// ─── 文件加密（§10.3）────────────────────────────────────────────────────────

/**
 * 加密文件内容（`KDF(H, "file", fileId)`，§10.3）。
 *
 * @param {Buffer | Uint8Array} plaintext 文件明文字节
 * @param {string | Buffer} H 群秘密
 * @param {string} fileId 文件 ID
 * @returns {{ iv: string, ciphertext: string, authTag: string }} 加密结果
 */
export function encryptFile(plaintext, H, fileId) {
	const key = deriveFileKey(H, fileId)
	const iv = randomBytes(12)
	const cipher = createCipheriv('aes-256-gcm', key, iv)
	const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
	const authTag = cipher.getAuthTag()
	return {
		iv: iv.toString('base64'),
		ciphertext: ciphertext.toString('base64'),
		authTag: authTag.toString('base64'),
	}
}

/**
 * 解密文件内容（`KDF(H, "file", fileId)`，§10.3）。
 *
 * @param {{ iv: string, ciphertext: string, authTag: string }} stored 加密结果（`encryptFile` 的输出）
 * @param {string | Buffer} H 群秘密
 * @param {string} fileId 文件 ID
 * @returns {Buffer | null} 明文字节；失败返回 null
 */
export function decryptFile(stored, H, fileId) {
	try {
		const key = deriveFileKey(H, fileId)
		const iv = Buffer.from(stored.iv, 'base64')
		const ciphertext = Buffer.from(stored.ciphertext, 'base64')
		const authTag = Buffer.from(stored.authTag, 'base64')
		const decipher = createDecipheriv('aes-256-gcm', key, iv)
		decipher.setAuthTag(authTag)
		return Buffer.concat([decipher.update(ciphertext), decipher.final()])
	}
	catch { return null }
}
