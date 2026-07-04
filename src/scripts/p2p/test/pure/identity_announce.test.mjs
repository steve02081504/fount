/**
 * identity_announce 签名单元测试（Deno）。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { keyPairFromSeed, pubKeyHash } from '../../crypto.mjs'
import {
	identityAnnounceMessage,
	verifyIdentityAnnounce,
} from '../../identity_announce.mjs'

Deno.test('identityAnnounceMessage is stable', () => {
	const msg = identityAnnounceMessage('peer-1', 'a'.repeat(64))
	assertEquals(Buffer.from(msg).toString('utf8').includes('peer-1'), true)
})

Deno.test('verifyIdentityAnnounce accepts valid node seed signature', async () => {
	const seed = Buffer.alloc(32, 7)
	const { publicKey, secretKey } = keyPairFromSeed(seed)
	const nodeHash = pubKeyHash(publicKey)
	const peerId = 'trystero-peer-abc'
	const message = identityAnnounceMessage(peerId, nodeHash)
	const { sign } = await import('../../crypto.mjs')
	const signature = await sign(message, secretKey)
	const ok = await verifyIdentityAnnounce({
		nodeHash,
		nodePubKey: Buffer.from(publicKey).toString('hex'),
		signature: Buffer.from(signature).toString('hex'),
	}, peerId)
	assertEquals(ok, nodeHash)
})

Deno.test('verifyIdentityAnnounce rejects spoofed nodeHash', async () => {
	const seed = Buffer.alloc(32, 7)
	const { publicKey, secretKey } = keyPairFromSeed(seed)
	const nodeHash = pubKeyHash(publicKey)
	const peerId = 'peer-x'
	const message = identityAnnounceMessage(peerId, nodeHash)
	const { sign } = await import('../../crypto.mjs')
	const signature = await sign(message, secretKey)
	const bad = await verifyIdentityAnnounce({
		nodeHash: 'b'.repeat(64),
		nodePubKey: Buffer.from(publicKey).toString('hex'),
		signature: Buffer.from(signature).toString('hex'),
	}, peerId)
	assertEquals(bad, null)
})
