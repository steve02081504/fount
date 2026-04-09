import * as ed from 'npm:@noble/ed25519'
import { createHash } from 'node:crypto'

/**
 * @param {Uint8Array|Buffer} seed 任意长度；非 32 字节时 sha256 派生
 */
export function keyPairFromSeed(seed) {
	const u = seed instanceof Uint8Array ? seed : new Uint8Array(seed)
	const sk = u.length === 32 ? u : new Uint8Array(createHash('sha256').update(u).digest())
	return { publicKey: ed.getPublicKey(sk), secretKey: sk }
}

export async function randomKeyPair() {
	const sk = ed.utils.randomPrivateKey()
	return { publicKey: ed.getPublicKey(sk), secretKey: sk }
}

/**
 * @param {Uint8Array} message
 * @param {Uint8Array} secretKey
 */
export async function sign(message, secretKey) {
	return ed.sign(message, secretKey.slice(0, 32))
}

/**
 * @param {Uint8Array} signature
 * @param {Uint8Array} message
 * @param {Uint8Array} publicKey
 */
export async function verify(signature, message, publicKey) {
	try {
		return ed.verify(signature, message, publicKey)
	}
	catch {
		return false
	}
}

export function pubKeyHash(publicKey) {
	return bufferToHexSimple(hashPubKeyBytes(publicKey))
}

function hashPubKeyBytes(publicKey) {
	return createHash('sha256').update(publicKey).digest()
}

function bufferToHexSimple(buf) {
	return Buffer.from(buf).toString('hex')
}
