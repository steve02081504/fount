import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'

import { keyPairFromSeed, pubKeyHash, sign, verify } from '../crypto.mjs'
import { isHex64, normalizeHex64 } from '../hexIds.mjs'
import { ensureNodeSeed, getNodeHash } from '../node/identity.mjs'

import { normalizeDtlsFingerprint } from './sdp_fingerprint.mjs'

/**
 * Link 握手签名域标识符。
 */
export const LINK_HANDSHAKE_DOMAIN = 'fount-link-v1'

/**
 * 构造 link auth 待签名字节串。
 * @param {string} peerNonce 对端 hello 中的 nonce（64 位 hex）
 * @param {string} localFingerprint 本地 DTLS fingerprint
 * @param {string} localNodeHash 本地节点 nodeHash（64 位 hex）
 * @returns {Uint8Array} 待签名消息字节
 */
export function buildAuthMessage(peerNonce, localFingerprint, localNodeHash) {
	const nonce = normalizeHex64(peerNonce)
	const fingerprint = normalizeDtlsFingerprint(localFingerprint)
	const nodeHash = normalizeHex64(localNodeHash)
	if (!/^[\da-f]{64}$/u.test(nonce))
		throw new Error('p2p: auth nonce must be 64 hex characters')
	if (!fingerprint)
		throw new Error('p2p: DTLS fingerprint missing or invalid')
	if (!isHex64(nodeHash))
		throw new Error('p2p: nodeHash must be 64 hex characters')
	return Buffer.from(`${LINK_HANDSHAKE_DOMAIN}\0${nonce}\0${fingerprint}\0${nodeHash}`, 'utf8')
}

/**
 * 构造 link hello 握手包。
 * @param {{ nodeHash?: string, nodePubKey?: string, nonce?: string }} [opts] 可选身份字段，省略则从本地节点种子推导
 * @returns {{ v: 1, nodeHash: string, nodePubKey: string, nonce: string }} hello 对象
 */
export function buildHello(opts = {}) {
	let publicKey = null
	if (!opts.nodeHash || !opts.nodePubKey) {
		const derived = keyPairFromSeed(Buffer.from(ensureNodeSeed(), 'hex'))
		publicKey = derived.publicKey
	}
	const nodeHash = normalizeHex64(opts.nodeHash || getNodeHash())
	const nodePubKey = normalizeHex64(opts.nodePubKey || Buffer.from(publicKey).toString('hex'))
	const nonce = normalizeHex64(opts.nonce || randomBytes(32).toString('hex'))
	if (!isHex64(nodeHash) || !isHex64(nodePubKey) || !isHex64(nonce))
		throw new Error('p2p: invalid hello fields')
	if (pubKeyHash(Buffer.from(nodePubKey, 'hex')) !== nodeHash)
		throw new Error('p2p: hello nodePubKey does not match nodeHash')
	return { v: 1, nodeHash, nodePubKey, nonce }
}

/**
 * 对 link auth 消息签名。
 * @param {string} peerNonce 对端 hello 中的 nonce
 * @param {string} localFingerprint 本地 DTLS fingerprint
 * @param {{ secretKey?: Uint8Array, nodeHash?: string }} [opts] 签名密钥与 nodeHash 覆盖
 * @returns {Promise<{ sig: string }>} hex 签名
 */
export async function buildAuth(peerNonce, localFingerprint, opts = {}) {
	const seed = opts.secretKey
		? Buffer.from(opts.secretKey)
		: Buffer.from(ensureNodeSeed(), 'hex')
	const { publicKey, secretKey } = keyPairFromSeed(seed)
	const nodeHash = normalizeHex64(opts.nodeHash || pubKeyHash(publicKey))
	if (nodeHash !== pubKeyHash(publicKey))
		throw new Error('p2p: auth nodeHash does not match secretKey')
	const message = buildAuthMessage(peerNonce, localFingerprint, nodeHash)
	const signature = await sign(message, secretKey)
	return { sig: Buffer.from(signature).toString('hex') }
}

/**
 * 解析并校验 hello 对象，无效时返回 null。
 * @param {unknown} hello 原始 hello 载荷
 * @returns {{ v: 1, nodeHash: string, nodePubKey: string, nonce: string } | null} 规范化 hello 或 null
 */
export function parseHello(hello) {
	const nodeHash = normalizeHex64(hello?.nodeHash)
	const nodePubKey = normalizeHex64(hello?.nodePubKey)
	const nonce = normalizeHex64(hello?.nonce)
	if (Number(hello?.v) !== 1) return null
	if (!isHex64(nodeHash) || !isHex64(nodePubKey) || !isHex64(nonce)) return null
	try {
		if (pubKeyHash(Buffer.from(nodePubKey, 'hex')) !== nodeHash) return null
	}
	catch {
		return null
	}
	return { v: 1, nodeHash, nodePubKey, nonce }
}

/**
 * 验证对端 auth 签名，成功返回对端 nodeHash。
 * @param {unknown} hello 对端 hello
 * @param {unknown} auth 对端 auth（含 sig）
 * @param {string} expectedNonce 本地 hello 发出的 nonce
 * @param {string} remoteFingerprintFromSdp 从 SDP 提取的远端 DTLS fingerprint
 * @returns {Promise<string | null>} 验证通过的 nodeHash，失败返回 null
 */
export async function verifyAuth(hello, auth, expectedNonce, remoteFingerprintFromSdp) {
	const parsedHello = parseHello(hello)
	if (!parsedHello) return null
	const signatureHex = String(auth?.sig ?? '').trim().toLowerCase()
	const fingerprint = normalizeDtlsFingerprint(remoteFingerprintFromSdp)
	if (!/^[\da-f]{128}$/u.test(signatureHex) || !fingerprint) return null
	const normalizedNonce = normalizeHex64(expectedNonce)
	if (!isHex64(normalizedNonce)) return null
	const message = buildAuthMessage(normalizedNonce, fingerprint, parsedHello.nodeHash)
	const ok = await verify(
		Buffer.from(signatureHex, 'hex'),
		message,
		Buffer.from(parsedHello.nodePubKey, 'hex'),
	)
	return ok ? parsedHello.nodeHash : null
}

/**
 * 构造 discovery advert 待签名字节串。
 * @param {string} topic 广播主题
 * @param {number} ts 时间戳（毫秒）
 * @param {string} nodeHash 节点 nodeHash
 * @returns {Uint8Array} 待签名消息字节
 */
export function buildAdvertMessage(topic, ts, nodeHash) {
	return Buffer.from(`fount-advert-v1\0${String(topic)}\0${String(ts)}\0${normalizeHex64(nodeHash)}`, 'utf8')
}

/**
 * 构造带签名的 discovery advert。
 * @param {string} topic 广播主题
 * @param {number} [ts=Date.now()] 时间戳（毫秒）
 * @param {{ secretKey?: Uint8Array, nodeHash?: string, nodePubKey?: string } | null} [opts] 签名身份，省略则用本地节点
 * @returns {Promise<{ nodeHash: string, nodePubKey: string, ts: number, sig: string }>} 签名 advert
 */
export async function buildSignedAdvert(topic, ts = Date.now(), opts = null) {
	const seed = opts?.secretKey
		? Buffer.from(opts.secretKey)
		: Buffer.from(ensureNodeSeed(), 'hex')
	const { publicKey, secretKey } = keyPairFromSeed(seed)
	const nodeHash = normalizeHex64(opts?.nodeHash || pubKeyHash(publicKey))
	const nodePubKey = normalizeHex64(opts?.nodePubKey || Buffer.from(publicKey).toString('hex'))
	if (pubKeyHash(Buffer.from(nodePubKey, 'hex')) !== nodeHash)
		throw new Error('p2p: advert nodePubKey does not match nodeHash')
	const message = buildAdvertMessage(topic, ts, nodeHash)
	const sig = await sign(message, secretKey)
	return {
		nodeHash,
		nodePubKey,
		ts,
		sig: Buffer.from(sig).toString('hex'),
	}
}

/**
 * 验证 discovery advert 签名与时间戳，成功返回发布者 nodeHash。
 * @param {string} topic 期望的广播主题
 * @param {unknown} advert 原始 advert 载荷
 * @param {number} [now=Date.now()] 当前时间（毫秒）
 * @param {number} [maxSkewMs=10 * 60_000] 允许的最大时钟偏差（毫秒）
 * @returns {Promise<string | null>} 验证通过的 nodeHash，失败返回 null
 */
export async function verifySignedAdvert(topic, advert, now = Date.now(), maxSkewMs = 10 * 60_000) {
	const parsedHello = parseHello({ v: 1, nodeHash: advert?.nodeHash, nodePubKey: advert?.nodePubKey, nonce: '0'.repeat(64) })
	if (!parsedHello) return null
	const ts = Number(advert?.ts)
	const sig = String(advert?.sig ?? '').trim().toLowerCase()
	if (!Number.isFinite(ts) || Math.abs(now - ts) > maxSkewMs || !/^[\da-f]{128}$/u.test(sig)) return null
	const message = buildAdvertMessage(topic, ts, parsedHello.nodeHash)
	const ok = await verify(Buffer.from(sig, 'hex'), message, Buffer.from(parsedHello.nodePubKey, 'hex'))
	return ok ? parsedHello.nodeHash : null
}
