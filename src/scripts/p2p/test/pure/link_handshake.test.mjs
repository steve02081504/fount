/* global Deno */
import { Buffer } from 'node:buffer'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { keyPairFromSeed, pubKeyHash } from '../../crypto.mjs'
import {
	buildAuth,
	buildSignedAdvert,
	buildHello,
	parseHello,
	verifyAuth,
	verifySignedAdvert,
} from '../../link/handshake.mjs'

const FINGERPRINT = 'aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99'

Deno.test('verifyAuth accepts a valid hello/auth pair', async () => {
	const seed = Buffer.alloc(32, 7)
	const { publicKey, secretKey } = keyPairFromSeed(seed)
	const nodeHash = pubKeyHash(publicKey)
	const hello = buildHello({
		nodeHash,
		nodePubKey: Buffer.from(publicKey).toString('hex'),
		nonce: '11'.repeat(32),
	})
	const auth = await buildAuth(hello.nonce, FINGERPRINT, { secretKey, nodeHash })
	assertEquals(await verifyAuth(hello, auth, hello.nonce, FINGERPRINT), nodeHash)
})

Deno.test('verifyAuth rejects fingerprint mismatch', async () => {
	const seed = Buffer.alloc(32, 8)
	const { publicKey, secretKey } = keyPairFromSeed(seed)
	const nodeHash = pubKeyHash(publicKey)
	const hello = buildHello({
		nodeHash,
		nodePubKey: Buffer.from(publicKey).toString('hex'),
		nonce: '22'.repeat(32),
	})
	const auth = await buildAuth(hello.nonce, FINGERPRINT, { secretKey, nodeHash })
	assertEquals(await verifyAuth(hello, auth, hello.nonce, FINGERPRINT.replace('aa', 'ff')), null)
})

Deno.test('parseHello rejects spoofed pubkey hash', () => {
	const seed = Buffer.alloc(32, 9)
	const { publicKey } = keyPairFromSeed(seed)
	assertEquals(parseHello({
		v: 1,
		nodeHash: 'ff'.repeat(32),
		nodePubKey: Buffer.from(publicKey).toString('hex'),
		nonce: '33'.repeat(32),
	}), null)
})

Deno.test('advert signatures verify against topic and timestamp', async () => {
	const seed = Buffer.alloc(32, 5)
	const { publicKey, secretKey } = keyPairFromSeed(seed)
	const nodeHash = pubKeyHash(publicKey)
	const topic = `topic:${nodeHash}`
	const advert = await buildSignedAdvert(topic, 1234, {
		secretKey,
		nodeHash,
		nodePubKey: Buffer.from(publicKey).toString('hex'),
	})
	assertEquals(await verifySignedAdvert(topic, advert, 1234), nodeHash)
})
