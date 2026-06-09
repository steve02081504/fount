import { Buffer } from 'node:buffer'

import { keyPairFromSeed, pubKeyHash, sign, verify } from './crypto.mjs'
import { ensureNodeSeed } from './federation/identity.mjs'
import { isHex64, normalizeHex64 } from './hexIds.mjs'
import { getNodeHash } from './node_context.mjs'

/** user room 在 trust graph / room provider 中的 scope id */
export const USER_ROOM_SCOPE = 'user-room'

/**
 * @param {string} peerId Trystero peer id
 * @param {string} nodeHash 64 hex
 * @returns {Uint8Array} 待签消息
 */
export function identityAnnounceMessage(peerId, nodeHash) {
	return Buffer.from(`${String(peerId)}\0${normalizeHex64(nodeHash)}`, 'utf8')
}

/**
 * @param {string} username replica 登录名
 * @param {string} peerId Trystero peer id
 * @returns {Promise<{ nodeHash: string, nodePubKey: string, signature: string }>} 可广播的身份载荷
 */
export async function buildIdentityAnnounce(username, peerId) {
	const nodeHash = getNodeHash(username)
	const seedHex = ensureNodeSeed(username)
	const { publicKey, secretKey } = keyPairFromSeed(Buffer.from(seedHex, 'hex'))
	if (pubKeyHash(publicKey) !== nodeHash)
		throw new Error('p2p: nodeHash does not match node seed')
	const message = identityAnnounceMessage(peerId, nodeHash)
	const signature = await sign(message, secretKey)
	return {
		nodeHash,
		nodePubKey: Buffer.from(publicKey).toString('hex'),
		signature: Buffer.from(signature).toString('hex'),
	}
}

/**
 * 校验入站 identity_announce；失败返回 null。
 * @param {unknown} payload Trystero 载荷
 * @param {string} peerId 发送方 peer id
 * @returns {Promise<string | null>} 已验证的 nodeHash
 */
export async function verifyIdentityAnnounce(payload, peerId) {
	const nodeHash = normalizeHex64(payload?.nodeHash)
	const nodePubKeyHex = normalizeHex64(payload?.nodePubKey)
	const signatureHex = payload?.signature?.trim()
	if (!isHex64(nodeHash) || !isHex64(nodePubKeyHex) || !signatureHex) return null
	const pubKey = Buffer.from(nodePubKeyHex, 'hex')
	if (pubKey.length !== 32 || pubKeyHash(pubKey) !== nodeHash) return null
	const message = identityAnnounceMessage(peerId, nodeHash)
	const ok = await verify(
		Buffer.from(signatureHex, 'hex'),
		message,
		pubKey,
	)
	return ok ? nodeHash : null
}
