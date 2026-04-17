import { Buffer } from 'node:buffer'
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

import { x25519 } from 'npm:@noble/curves/ed25519.js'

// @noble/curves API 说明：
// x25519.getPublicKey(privateKey: Uint8Array) → Uint8Array (32字节 X25519 公钥)
// x25519.getSharedSecret(privateKey: Uint8Array, publicKey: Uint8Array) → Uint8Array (32字节 ECDH 共享密钥)
// ed25519PublicKeyToX25519 手动实现 Edwards→Montgomery 双有理映射（u = (1+y)/(1-y) mod p）

// Ed25519 曲线素数 p = 2^255 - 19
const P = (1n << 255n) - 19n

/**
 * 模逆元，使用费马小定理（要求模数为素数）
 * @param {bigint} a 被求逆的整数
 * @param {bigint} m 模数（必须为素数）
 * @returns {bigint} a 在模 m 下的逆元
 */
function modInv(a, m) {
	// 使用费马小定理：a^(p-2) mod p（p 为素数）
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
 * 将 Ed25519 公钥（32字节，Edwards y 坐标，小端序）转换为 X25519 公钥（Montgomery u 坐标）
 * 转换公式：u = (1 + y) / (1 - y) mod p（RFC 7748 §4.1）
 * @param {Uint8Array} edPub Ed25519 公钥（32字节）
 * @returns {Uint8Array} X25519 公钥（32字节，小端序）
 */
function ed25519PublicKeyToX25519(edPub) {
	// Ed25519 公钥格式：小端序 32 字节，最高位是 x 的符号位
	const bytes = new Uint8Array(edPub)
	// 清除符号位，读取 y 坐标
	const yCopy = new Uint8Array(bytes)
	yCopy[31] &= 0x7f

	// 小端序字节数组 → BigInt
	let y = 0n
	for (let i = 31; i >= 0; i--)
		y = (y << 8n) | BigInt(yCopy[i])

	// u = (1 + y) / (1 - y) mod p
	const u = (1n + y) * modInv(1n - y + P, P) % P

	// BigInt → 小端序 32 字节
	const result = new Uint8Array(32)
	let tmp = u
	for (let i = 0; i < 32; i++) {
		result[i] = Number(tmp & 0xffn)
		tmp >>= 8n
	}
	return result
}

/**
 * 将 Ed25519 私钥种子（32字节）转换为 X25519 私钥（RFC 7748 §4.1）
 * 算法：SHA-512(seed) 取前32字节，然后做 clamp 操作
 * @param {Uint8Array} seed Ed25519 私钥种子（32字节）
 * @returns {Uint8Array} X25519 私钥（32字节，已 clamp）
 */
function ed25519PrivKeyToX25519(seed) {
	const hash = createHash('sha512').update(seed).digest()
	const key = new Uint8Array(32) // 独立缓冲区，避免 clamp 修改原 hash 数据
	for (let i = 0; i < 32; i++) key[i] = hash[i]
	key[0] &= 248   // 清除低3位
	key[31] &= 127  // 清除最高位
	key[31] |= 64   // 设置第二高位
	return key
}

/**
 * 将消息内容序列化为持久化格式。
 * - 当 visibility 为 null/undefined 时（全员可见），直接返回明文。
 * - 当有 visibility 限制时，使用 ECDH X25519 + AES-256-GCM 加密：
 *   对每个接收方生成独立的 ECDH 临时密钥对，以接收方 X25519 公钥封装 AES 密钥。
 *
 * @param {string} content 消息内容（明文）
 * @param {object|null|undefined} visibility 可见性约束 `{ roles?, members? }` 或 null
 * @param {SerializeContext} context 加密上下文
 * @returns {{
 *   encrypted: false,
 *   content: string
 * } | {
 *   encrypted: true,
 *   ciphertext: string,
 *   iv: string,
 *   authTag: string,
 *   recipientKeys: Array<{ pubKeyHash: string, encryptedKey: string, ephemPub: string }>
 * }} 序列化结果
 *
 * @typedef {{
 *   recipientPubKeyHexes: string[],
 *   recipientPubKeyHashes: string[],
 * }} SerializeContext
 */
export function serializeMessageContent(content, visibility, context) {
	if (!visibility)
		return { content, encrypted: false }

	// 若无接收方上下文（密钥未就绪），回退明文——调用方应确保传入 context
	if (!context?.recipientPubKeyHexes?.length)
		return { content, encrypted: false }

	// 生成随机 AES-256 密钥和 IV
	const aesKey = randomBytes(32)
	const iv = randomBytes(12)

	// AES-256-GCM 加密消息内容
	const cipher = createCipheriv('aes-256-gcm', aesKey, iv)
	const ciphertext = Buffer.concat([cipher.update(content, 'utf8'), cipher.final()])
	const authTag = cipher.getAuthTag()

	// 对每个接收方封装 AES 密钥
	const recipientKeys = context.recipientPubKeyHexes.map((hexKey, i) => {
		const pubKeyHash = context.recipientPubKeyHashes[i]
		const edPubBytes = Buffer.from(hexKey, 'hex')

		// Ed25519 公钥 → X25519 公钥
		const recipientX25519Pub = ed25519PublicKeyToX25519(edPubBytes)

		// 生成临时 X25519 密钥对
		const ephemPriv = x25519.utils.randomPrivateKey()
		const ephemPub = x25519.getPublicKey(ephemPriv)

		// ECDH 共享密钥
		const sharedSecret = x25519.getSharedSecret(ephemPriv, recipientX25519Pub)

		// SHA-256(sharedSecret) 作为封装 AES 密钥的密钥
		const wrapKey = createHash('sha256').update(sharedSecret).digest()
		const zeroIv = Buffer.alloc(12, 0)

		// 用 AES-256-GCM 加密 aesKey
		const keyCipher = createCipheriv('aes-256-gcm', wrapKey, zeroIv)
		const encryptedKeyBuf = Buffer.concat([keyCipher.update(aesKey), keyCipher.final()])
		const keyAuthTag = keyCipher.getAuthTag()

		return {
			pubKeyHash,
			encryptedKey: Buffer.concat([encryptedKeyBuf, keyAuthTag]).toString('base64'),
			ephemPub: Buffer.from(ephemPub).toString('base64'),
		}
	})

	return {
		encrypted: true,
		ciphertext: ciphertext.toString('base64'),
		iv: iv.toString('base64'),
		authTag: authTag.toString('base64'),
		recipientKeys,
	}
}

/**
 * 将持久化格式反序列化为消息内容。
 * - encrypted: false 时直接返回明文。
 * - encrypted: true 时，用当前用户私钥解密 ECDH 封装的 AES 密钥，再解密消息内容。
 *   若当前用户不在接收方列表中，返回 null。
 *
 * @param {{
 *   encrypted: false,
 *   content: string
 * } | {
 *   encrypted: true,
 *   ciphertext: string,
 *   iv: string,
 *   authTag: string,
 *   recipientKeys: Array<{ pubKeyHash: string, encryptedKey: string, ephemPub: string }>
 * }} stored 持久化载荷
 * @param {DeserializeContext} context 解密上下文
 * @returns {string|null} 消息内容，无权限或解密失败时返回 null
 *
 * @typedef {{
 *   myPubKeyHash: string,
 *   mySecretKeyBytes: Uint8Array,
 * }} DeserializeContext
 */
export function deserializeMessageContent(stored, context) {
	if (!stored.encrypted)
		return stored.content

	// 查找当前用户对应的加密密钥条目
	const entry = stored.recipientKeys?.find(k => k.pubKeyHash === context?.myPubKeyHash)
	if (!entry) return null

	try {
		// Ed25519 私钥种子 → X25519 私钥
		const myX25519Priv = ed25519PrivKeyToX25519(context.mySecretKeyBytes)

		// 解析临时公钥并执行 ECDH
		const ephemPub = Buffer.from(entry.ephemPub, 'base64')
		const sharedSecret = x25519.getSharedSecret(myX25519Priv, ephemPub)

		// SHA-256(sharedSecret) 作为解封装密钥
		const wrapKey = createHash('sha256').update(sharedSecret).digest()
		const zeroIv = Buffer.alloc(12, 0)

		// 解密封装的 AES 密钥（末尾16字节为 authTag）
		const encKeyBuf = Buffer.from(entry.encryptedKey, 'base64')
		const encKeyData = encKeyBuf.slice(0, encKeyBuf.length - 16)
		const keyAuthTag = encKeyBuf.slice(encKeyBuf.length - 16)

		const keyDecipher = createDecipheriv('aes-256-gcm', wrapKey, zeroIv)
		keyDecipher.setAuthTag(keyAuthTag)
		const aesKey = Buffer.concat([keyDecipher.update(encKeyData), keyDecipher.final()])

		// 用 AES 密钥解密消息内容
		const iv = Buffer.from(stored.iv, 'base64')
		const authTag = Buffer.from(stored.authTag, 'base64')
		const ciphertext = Buffer.from(stored.ciphertext, 'base64')

		const decipher = createDecipheriv('aes-256-gcm', aesKey, iv)
		decipher.setAuthTag(authTag)
		return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
	}
	catch {
		return null
	}
}

/**
 * 检查当前 member 是否有权看到某条消息
 * OR 语义：满足 roles 或 members 任一条件即可见
 * @param {{ roles?: string[], members?: string[] }|null|undefined} visibility 可见性约束
 * @param {{ memberId: string, roles: string[], charId?: string }} viewer 当前查看者
 * @returns {boolean} 是否可见
 */
export function canViewMessage(visibility, viewer) {
	if (!visibility) return true
	const { roles, members } = visibility
	const hasRoles = Array.isArray(roles) && roles.length > 0
	const hasMembers = Array.isArray(members) && members.length > 0
	if (!hasRoles && !hasMembers) return true
	if (hasMembers && (members.includes(viewer.memberId) || (viewer.charId && members.includes(viewer.charId))))
		return true
	if (hasRoles && roles.some(r => viewer.roles?.includes(r))) return true
	return false
}
