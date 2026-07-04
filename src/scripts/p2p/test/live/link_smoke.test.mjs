/* global Deno */
import { Buffer } from 'node:buffer'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { keyPairFromSeed, pubKeyHash } from '../../crypto.mjs'
import { DEFAULT_ICE_SERVERS } from '../../ice_servers.mjs'
import { createLink } from '../../link/link.mjs'

/**
 * @param {number} fill
 * @returns {{ nodeHash: string, nodePubKey: string, secretKey: Uint8Array }}
 */
function identity(fill) {
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
function createSignalPair() {
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

Deno.test({
	name: 'link smoke completes handshake and identifies remote node',
	sanitizeOps: false,
	sanitizeResources: false,
	async fn() {
		const alice = identity(1)
		const bob = identity(2)
		const signals = createSignalPair()
		const aliceLink = await createLink({
			nodeHash: bob.nodeHash,
			initiator: true,
			signal: signals.left,
			iceServers: DEFAULT_ICE_SERVERS,
			localIdentity: alice,
		})
		const bobLink = await createLink({
			nodeHash: alice.nodeHash,
			initiator: false,
			signal: signals.right,
			iceServers: DEFAULT_ICE_SERVERS,
			localIdentity: bob,
		})
		try {
			await Promise.all([aliceLink.ready, bobLink.ready])
			assertEquals(aliceLink.nodeHash, bob.nodeHash)
			assertEquals(bobLink.nodeHash, alice.nodeHash)
		}
		finally {
			await aliceLink.close('test-done')
			await bobLink.close('test-done')
		}
	},
})
