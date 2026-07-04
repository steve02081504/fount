import { Buffer } from 'node:buffer'

import { keyPairFromSeed, pubKeyHash } from '../../crypto.mjs'

/**
 * @param {number} fill
 * @returns {{ nodeHash: string, nodePubKey: string, secretKey: Uint8Array }}
 */
export function identity(fill) {
	const { publicKey, secretKey } = keyPairFromSeed(Buffer.alloc(32, fill))
	return {
		nodeHash: pubKeyHash(publicKey),
		nodePubKey: Buffer.from(publicKey).toString('hex'),
		secretKey,
	}
}

/**
 * @returns {{ left: { send: (message: unknown) => void, onRemote: (handler: (message: unknown) => void) => () => void }, right: { send: (message: unknown) => void, onRemote: (handler: (message: unknown) => void) => () => void } }}
 */
export function createSignalPair() {
	let leftHandler = null
	let rightHandler = null
	const leftQueue = []
	const rightQueue = []
	return {
		left: {
			send(message) {
				queueMicrotask(() => {
					if (rightHandler === null) rightQueue.push(message)
					else rightHandler(message)
				})
			},
			onRemote(handler) {
				leftHandler = handler
				for (const message of leftQueue.splice(0))
					queueMicrotask(() => handler(message))
				return () => { leftHandler = null }
			},
		},
		right: {
			send(message) {
				queueMicrotask(() => {
					if (leftHandler === null) leftQueue.push(message)
					else leftHandler(message)
				})
			},
			onRemote(handler) {
				rightHandler = handler
				for (const message of rightQueue.splice(0))
					queueMicrotask(() => handler(message))
				return () => { rightHandler = null }
			},
		},
	}
}

/**
 * @param {() => boolean} predicate
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
export async function waitFor(predicate, timeoutMs) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (predicate()) return
		await new Promise(resolve => setTimeout(resolve, 50))
	}
	throw new Error(`waitFor timeout after ${timeoutMs}ms`)
}
