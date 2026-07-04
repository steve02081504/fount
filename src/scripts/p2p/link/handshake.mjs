import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'

import { keyPairFromSeed, pubKeyHash, sign, verify } from '../crypto.mjs'
import { isHex64, normalizeHex64 } from '../hexIds.mjs'
import { ensureNodeSeed, getNodeHash } from '../node/identity.mjs'
import { normalizeDtlsFingerprint } from './sdp_fingerprint.mjs'

export const LINK_HANDSHAKE_DOMAIN = 'fount-link-v1'

/**
 * @param {string} peerNonce
 * @param {string} localFingerprint
 * @param {string} localNodeHash
 * @returns {Uint8Array}
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
 * @param {{ nodeHash?: string, nodePubKey?: string, nonce?: string }} [opts]
 * @returns {{ v: 1, nodeHash: string, nodePubKey: string, nonce: string }}
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
 * @param {string} peerNonce
 * @param {string} localFingerprint
 * @param {{ secretKey?: Uint8Array, nodeHash?: string }} [opts]
 * @returns {Promise<{ sig: string }>}
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
 * @param {unknown} hello
 * @returns {{ v: 1, nodeHash: string, nodePubKey: string, nonce: string } | null}
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
 * @param {unknown} hello
 * @param {unknown} auth
 * @param {string} expectedNonce
 * @param {string} remoteFingerprintFromSdp
 * @returns {Promise<string | null>}
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
 * @param {string} topic
 * @param {number} ts
 * @param {string} nodeHash
 * @returns {Uint8Array}
 */
export function buildAdvertMessage(topic, ts, nodeHash) {
	return Buffer.from(`fount-advert-v1\0${String(topic)}\0${String(ts)}\0${normalizeHex64(nodeHash)}`, 'utf8')
}

/**
 * @param {string} topic
 * @param {number} [ts=Date.now()]
 * @param {{ secretKey?: Uint8Array, nodeHash?: string, nodePubKey?: string } | null} [opts]
 * @returns {Promise<{ nodeHash: string, nodePubKey: string, ts: number, sig: string }>}
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
 * @param {string} topic
 * @param {unknown} advert
 * @param {number} [now=Date.now()]
 * @param {number} [maxSkewMs=10 * 60_000]
 * @returns {Promise<string | null>}
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
