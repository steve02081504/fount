/**
 * 【文件】ws/signing.mjs
 * 【职责】群 WebSocket VOLATILE 流分片（stream_chunk）的 Ed25519 签名与验签，密钥来自联邦 identity 种子。
 * 【原理】resolveStreamSigner 缓存用户级 keyPair；attachStreamVolatileSignature 在广播前签名；verifyStreamChunkVolatile 供 WS 入站与 federation/volatile 入站复用。配置变更时 invalidateStreamSignerCache。
 * 【数据结构】signerCache Map→{ pubKeyHex, pubKeyHash, secretKey, signChunk }；chunk 含 senderPubKey、signature。
 * 【关联】federation/config.mjs、volatile.mjs、groupWsBroadcast；scripts/p2p/stream_volatile_signature.mjs。
 */
import { Buffer } from 'node:buffer'

import { pubKeyHash } from '../../../../../../../scripts/p2p/crypto.mjs'
import { isHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import {
	boundStreamSlices,
	signStreamSignatureHex,
	streamChunkSignBytes,
	streamKeyPairFromUserSeed,
	verifyStreamSignatureHex,
} from '../../../../../../../scripts/p2p/stream_volatile_signature.mjs'
import { getFederationIdentitySecret } from '../federation/config.mjs'

/** @type {Map<string, { pubKeyHex: string, pubKeyHash: string, secretKey: Uint8Array }>} */
const signerCache = new Map()

/**
 * 联邦口令变更后丢弃缓存的流签名器。
 * @param {string} [username] 指定用户；省略则清空全部
 * @returns {void}
 */
export function invalidateStreamSignerCache(username) {
	if (username) signerCache.delete(String(username).trim())
	else signerCache.clear()
}

/**
 * 解析用户出站 VOLATILE 签名器（缓存）。
 * @param {string} username 用户
 * @returns {{ pubKeyHex: string, pubKeyHash: string, signChunk: (pendingStreamId: string, chunkSeq: number, text: string) => Promise<string> }} 签名器
 */
export async function resolveStreamSigner(username) {
	const u = String(username || '').trim()
	if (!u) throw new Error('stream signer: username required')
	let cached = signerCache.get(u)
	if (cached) return cached
	const identitySecretKeyHex = await getFederationIdentitySecret(u)
	if (!isHex64(identitySecretKeyHex))
		throw new Error('federation identitySecretKeyHex required for stream signing')
	const kp = streamKeyPairFromUserSeed(u, identitySecretKeyHex)
	const pubKeyHex = Buffer.from(kp.publicKey).toString('hex')
	cached = {
		pubKeyHex,
		pubKeyHash: pubKeyHash(kp.publicKey),
		secretKey: kp.secretKey,
		/**
		 * @param {string} pendingStreamId 流 id
		 * @param {number} chunkSeq 序号
		 * @param {object[]} slices 差异切片
		 * @returns {Promise<string>} hex 签名
		 */
		async signChunk(pendingStreamId, chunkSeq, slices) {
			const bytes = streamChunkSignBytes(pendingStreamId, chunkSeq, slices)
			return signStreamSignatureHex(bytes, kp.secretKey)
		},
	}
	signerCache.set(u, cached)
	return cached
}

/**
 * 为 VOLATILE `stream_chunk` 载荷附加 `senderPubKey` 与 `signature`。
 * @param {string} username 签名用户
 * @param {object} payload 广播体（须含 type / pendingStreamId）
 * @returns {Promise<object>} 带签名字段的载荷
 */
export async function attachStreamVolatileSignature(username, payload) {
	const signer = await resolveStreamSigner(username)
	const type = payload?.type
	const pendingStreamId = String(payload?.pendingStreamId || '')
	if (!pendingStreamId) return { ...payload, senderPubKey: signer.pubKeyHex }

	if (type === 'stream_chunk') {
		const signatureHex = await signer.signChunk(
			pendingStreamId,
			Number(payload.chunkSeq ?? 0),
			payload.slices ?? [],
		)
		return { ...payload, senderPubKey: signer.pubKeyHex, signature: signatureHex }
	}
	return { ...payload, senderPubKey: signer.pubKeyHex }
}

/** 无签名规范的 VOLATILE 类型（联邦入站允许，但 `ai_stream_chunk` 等未定义签名的类型须拒绝）。 */
const UNSIGNED_FED_VOLATILE_TYPES = new Set([
	'reputation_slash_alert',
])

/**
 * 校验入站 VOLATILE 载荷（§6.4）：`stream_chunk` 验签；白名单无签名类型放行；其余拒绝。
 * @param {object} payload WS / 联邦载荷
 * @returns {Promise<boolean>} 合法为 true
 */
export async function verifyStreamChunkVolatile(payload) {
	const type = payload?.type
	if (UNSIGNED_FED_VOLATILE_TYPES.has(type)) return true
	if (type !== 'stream_chunk') return false
	const pendingStreamId = String(payload.pendingStreamId || '')
	const senderPubKey = String(payload.senderPubKey || '').trim().toLowerCase()
	const signatureHex = String(payload.signature || '').trim().toLowerCase()
	if (!pendingStreamId || !senderPubKey || !signatureHex) return false
	const slices = boundStreamSlices(payload.slices ?? [])
	if (!slices) return false
	const bytes = streamChunkSignBytes(pendingStreamId, Number(payload.chunkSeq ?? 0), slices)
	return verifyStreamSignatureHex(bytes, signatureHex, senderPubKey)
}
