/**
 * 群/实体主密钥 KDF 与 ECIES 封装（频道 K_ch、fileMasterKey、vault master key）。
 */

import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'

import { x25519 } from 'npm:@noble/curves/ed25519.js'

import { createLruMap } from './utils/memo.mjs'

// ─── KDF ──────────────────────────────────────────────────────────────────────

const KDF_CACHE_MAX = 512

const kdfCache = createLruMap(KDF_CACHE_MAX)

/** 清空 KDF 派生缓存（H 轮换后调用）。 */
export function clearMasterKeyKdfCache() {
	kdfCache.clear()
}

/**
 * @param {string | Buffer | Uint8Array} H 群秘密
 * @param {string} label 用途标签
 * @param {string} id 上下文 id
 * @returns {string} 缓存键
 */
function kdfCacheKey(H, label, id) {
	const hHex = typeof H === 'string' ? H : Buffer.from(H).toString('hex')
	return `${hHex}:${label}:${id}`
}

/**
 * HMAC-SHA256(key=H, data=label + "\x00" + id) → 32 字节 AES-256 密钥
 * @param {Buffer} H 32 字节群秘密
 * @param {string} label 用途标签（"broadcast" / "file" / "dm"）
 * @param {string} id channelId / fileId 等
 * @returns {Buffer} 32 字节派生密钥
 */
function kdf(H, label, id) {
	const cacheKey = kdfCacheKey(H, label, id)
	const cached = kdfCache.get(cacheKey)
	if (cached) {
		kdfCache.touch(cacheKey, cached)
		return Buffer.from(cached)
	}
	const derived = createHmac('sha256', H)
		.update(label)
		.update('\x00')
		.update(id)
		.digest()
	kdfCache.touch(cacheKey, Buffer.from(derived))
	return derived
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

/**
 * 推导 social 帖子加密密钥：`KDF(H, "post", postId)`（social shell §6）
 * @param {string | Buffer} H vault 秘密
 * @param {string} postId 帖子 ID
 * @returns {Buffer} 32 字节 AES-256 密钥
 */
export function deriveSocialPostKey(H, postId) {
	return kdf(toHBuf(H), 'post', String(postId))
}

/**
 * 推导流媒体观看令牌 HMAC 密钥：`KDF(H, "streaming", groupId)`（与群密钥同步轮换）。
 * @param {string | Buffer} H 群秘密
 * @param {string} groupId 群 ID
 * @returns {Buffer} 32 字节 HMAC 密钥
 */
export function deriveStreamingAuthKey(H, groupId) {
	return kdf(toHBuf(H), 'streaming', String(groupId))
}

// ─── H 轮换（§11.2、§6.3 key_rotate）──────────────────────────────────────

/**
 * 踢人/主动轮换后推导新 fileMasterKey：`K_new = SHA256(K_old || eventId || nonce)`
 *
 * @param {string} oldKeyHex 旧密钥（十六进制）
 * @param {string} eventId 踢人/轮换事件 ID（签名后的 SHA256 hex）
 * @param {string} nonce `new_key_nonce` 字段（字符串）
 * @returns {string} 新密钥（十六进制）
 */
export function deriveNextFileMasterKey(oldKeyHex, eventId, nonce) {
	return createHash('sha256')
		.update(Buffer.from(oldKeyHex, 'hex'))
		.update(String(eventId))
		.update(String(nonce))
		.digest('hex')
}

/**
 * 生成随机 32 字节 fileMasterKey（十六进制）。
 * @returns {string} 随机密钥 hex
 */
export function generateFileMasterKey() {
	return randomBytes(32).toString('hex')
}

/**
 * 生成随机 `new_key_nonce`，用于踢人事件或 key_rotate 事件。
 * @returns {string} 32 字节 hex 随机 nonce
 */
export function generateKeyRotationNonce() {
	return randomBytes(32).toString('hex')
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

// ─── ECIES 密钥包装（§11.1 peer_invite、频道/文件主密钥分发）────────────────

/**
 * X25519 ECIES 包装任意 32 字节 hex 密钥给成员 Ed25519 公钥。
 * @param {string} keyHex 32 字节 hex 密钥
 * @param {string} recipientEdPubKeyHex 64 hex Ed25519 公钥
 * @returns {{ ephemPub: string, iv: string, ciphertext: string, authTag: string }} ECIES 包装
 */
export function wrapKeyEcies(keyHex, recipientEdPubKeyHex) {
	const memberX25519Pub = edPubToX25519(Buffer.from(recipientEdPubKeyHex, 'hex'))
	const ephemPriv = x25519.utils.randomSecretKey()
	const ephemPub = x25519.getPublicKey(ephemPriv)
	const sharedSecret = x25519.getSharedSecret(ephemPriv, memberX25519Pub)
	const wrapKey = createHash('sha256').update(sharedSecret).digest()
	const iv = randomBytes(12)
	const cipher = createCipheriv('aes-256-gcm', wrapKey, iv)
	const H_bytes = Buffer.from(keyHex, 'hex')
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
 * 用本节点 Ed25519 私钥种子解密 ECIES 包装的 32 字节 hex 密钥。
 * @param {{ ephemPub: string, iv: string, ciphertext: string, authTag: string }} encryptedH ECIES 包装
 * @param {Uint8Array} myEdPrivKeySeed 32 字节私钥种子
 * @returns {string | null} 解密后的密钥 hex；失败为 null
 */
export function unwrapKeyEcies(encryptedH, myEdPrivKeySeed) {
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

/**
 * ECIES 封装任意 UTF-8 载荷（联邦 MQTT bootstrap 等）。
 * @param {string} utf8Text 明文
 * @param {string} memberEdPubKeyHex 成员 Ed25519 公钥 hex
 * @returns {{ ephemPub: string, iv: string, ciphertext: string, authTag: string }} ECIES 加密结果
 */
export function encryptUtf8ForMember(utf8Text, memberEdPubKeyHex) {
	const memberX25519Pub = edPubToX25519(Buffer.from(memberEdPubKeyHex, 'hex'))
	const ephemPriv = x25519.utils.randomSecretKey()
	const ephemPub = x25519.getPublicKey(ephemPriv)
	const sharedSecret = x25519.getSharedSecret(ephemPriv, memberX25519Pub)
	const wrapKey = createHash('sha256').update(sharedSecret).digest()
	const iv = randomBytes(12)
	const cipher = createCipheriv('aes-256-gcm', wrapKey, iv)
	const plain = Buffer.from(String(utf8Text), 'utf8')
	const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()])
	const authTag = cipher.getAuthTag()
	return {
		ephemPub: Buffer.from(ephemPub).toString('base64'),
		iv: iv.toString('base64'),
		ciphertext: ciphertext.toString('base64'),
		authTag: authTag.toString('base64'),
	}
}

/**
 * @param {{ ephemPub: string, iv: string, ciphertext: string, authTag: string }} encrypted 密文对象
 * @param {Uint8Array} myEdPrivKeySeed 本机私钥种子
 * @returns {string | null} UTF-8 明文
 */
export function decryptUtf8ForMember(encrypted, myEdPrivKeySeed) {
	try {
		const myX25519Priv = edPrivToX25519(myEdPrivKeySeed)
		const ephemPub = Buffer.from(encrypted.ephemPub, 'base64')
		const sharedSecret = x25519.getSharedSecret(myX25519Priv, ephemPub)
		const wrapKey = createHash('sha256').update(sharedSecret).digest()
		const iv = Buffer.from(encrypted.iv, 'base64')
		const ciphertext = Buffer.from(encrypted.ciphertext, 'base64')
		const authTag = Buffer.from(encrypted.authTag, 'base64')
		const decipher = createDecipheriv('aes-256-gcm', wrapKey, iv)
		decipher.setAuthTag(authTag)
		return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
	}
	catch { return null }
}

// ─── 收敛内容加密（§10.3 两层方案）──────────────────────────────────────────

/**
 * `contentKey = KDF(SHA256(plaintext), "ce")` 的 KDF 输入为 contentHash 字节。
 * @param {string} contentHashHex 明文 SHA-256（hex）
 * @returns {Buffer} 32 字节 contentKey
 */
export function deriveContentKey(contentHashHex) {
	return createHmac('sha256', Buffer.from(contentHashHex, 'hex'))
		.update('ce')
		.update('\x00')
		.digest()
}

/**
 * 收敛加密：同明文 → 同密文（IV 由 contentHash 前 12 字节派生）。
 * @param {Buffer | Uint8Array} plaintext 明文字节
 * @returns {{ contentHash: string, ciphertextHash: string, raw: Buffer }} 哈希与密文原始字节
 */
export function encryptConvergentPlaintext(plaintext) {
	const plain = Buffer.from(plaintext)
	const contentHash = createHash('sha256').update(plain).digest('hex')
	const contentKey = deriveContentKey(contentHash)
	const iv = Buffer.from(contentHash, 'hex').subarray(0, 12)
	const cipher = createCipheriv('aes-256-gcm', contentKey, iv)
	const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()])
	const authTag = cipher.getAuthTag()
	const raw = Buffer.concat([iv, authTag, ciphertext])
	const ciphertextHash = createHash('sha256').update(raw).digest('hex')
	return { contentHash, ciphertextHash, raw }
}

/**
 * 高隐私模式：随机 contentKey + 随机 IV（放弃跨文件 dedup）。
 * @param {Buffer | Uint8Array} plaintext 明文字节
 * @returns {{ contentHash: string, ciphertextHash: string, contentKey: Buffer, raw: Buffer }} 哈希、随机密钥与密文
 */
export function encryptRandomPlaintext(plaintext) {
	const plain = Buffer.from(plaintext)
	const contentHash = createHash('sha256').update(plain).digest('hex')
	const contentKey = randomBytes(32)
	const iv = randomBytes(12)
	const cipher = createCipheriv('aes-256-gcm', contentKey, iv)
	const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()])
	const authTag = cipher.getAuthTag()
	const raw = Buffer.concat([iv, authTag, ciphertext])
	const ciphertextHash = createHash('sha256').update(raw).digest('hex')
	return { contentHash, ciphertextHash, contentKey, raw }
}

/**
 * 解密收敛密文块（`raw` = iv(12) || authTag(16) || ciphertext）。
 * @param {Buffer | Uint8Array} raw 磁盘上的密文块
 * @param {string} contentHashHex 期望的明文哈希（校验用）
 * @returns {Buffer | null} 明文；校验失败为 null
 */
export function decryptConvergentCiphertext(raw, contentHashHex) {
	try {
		const buf = Buffer.from(raw)
		if (buf.length < 28) return null
		const iv = buf.subarray(0, 12)
		const authTag = buf.subarray(12, 28)
		const ciphertext = buf.subarray(28)
		const contentKey = deriveContentKey(contentHashHex)
		const decipher = createDecipheriv('aes-256-gcm', contentKey, iv)
		decipher.setAuthTag(authTag)
		const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
		const check = createHash('sha256').update(plain).digest('hex')
		if (check !== contentHashHex.toLowerCase()) return null
		return plain
	}
	catch { return null }
}

/**
 * 用随机 contentKey 解密密文块（`raw` = iv(12) || authTag(16) || ciphertext）。
 * @param {Buffer | Uint8Array} raw 磁盘上的密文块
 * @param {Buffer | Uint8Array} contentKey 32 字节随机 contentKey
 * @param {string} [contentHashHex] 可选明文哈希（用于完整性校验）
 * @returns {Buffer | null} 明文；校验失败返回 null
 */
export function decryptRandomCiphertext(raw, contentKey, contentHashHex = '') {
	try {
		const buf = Buffer.from(raw)
		if (buf.length < 28) return null
		const iv = buf.subarray(0, 12)
		const authTag = buf.subarray(12, 28)
		const ciphertext = buf.subarray(28)
		const decipher = createDecipheriv('aes-256-gcm', Buffer.from(contentKey), iv)
		decipher.setAuthTag(authTag)
		const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
		const expect = String(contentHashHex || '').trim().toLowerCase()
		if (expect) {
			const check = createHash('sha256').update(plain).digest('hex')
			if (check !== expect) return null
		}
		return plain
	}
	catch { return null }
}

/**
 * 用 `KDF(H,"file",fileId)` 包裹 contentKey（§10.3 wrappedKey）。
 * @param {Buffer} contentKey 32 字节
 * @param {string | Buffer} H 群秘密
 * @param {string} fileId 文件 ID
 * @returns {{ iv: string, ciphertext: string, authTag: string }} 可 JSON 序列化的包裹密钥
 */
export function wrapContentKey(contentKey, H, fileId) {
	const wrapKey = deriveFileKey(H, fileId)
	const iv = randomBytes(12)
	const cipher = createCipheriv('aes-256-gcm', wrapKey, iv)
	const ciphertext = Buffer.concat([cipher.update(contentKey), cipher.final()])
	const authTag = cipher.getAuthTag()
	return {
		iv: iv.toString('base64'),
		ciphertext: ciphertext.toString('base64'),
		authTag: authTag.toString('base64'),
	}
}

/**
 * 解开 wrappedKey 得到 contentKey。
 * @param {{ iv: string, ciphertext: string, authTag: string }} wrapped 包裹结构
 * @param {string | Buffer} H 群秘密
 * @param {string} fileId 文件 ID
 * @returns {Buffer | null} 32 字节 contentKey
 */
export function unwrapContentKey(wrapped, H, fileId) {
	try {
		const wrapKey = deriveFileKey(H, fileId)
		const iv = Buffer.from(wrapped.iv, 'base64')
		const ciphertext = Buffer.from(wrapped.ciphertext, 'base64')
		const authTag = Buffer.from(wrapped.authTag, 'base64')
		const decipher = createDecipheriv('aes-256-gcm', wrapKey, iv)
		decipher.setAuthTag(authTag)
		return Buffer.concat([decipher.update(ciphertext), decipher.final()])
	}
	catch { return null }
}
