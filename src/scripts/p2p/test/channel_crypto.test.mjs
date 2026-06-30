import { Buffer } from 'node:buffer'

/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	CKG_SCHEME,
	decryptWithChannelKey,
	encryptWithChannelKey,
	generateChannelKey,
	unwrapChannelKey,
	wrapChannelKey,
} from '../channel_crypto.mjs'
import { publicKeyFromSeed } from '../crypto.mjs'

Deno.test('channel key HPKE wrap roundtrip', () => {
	const seed = new Uint8Array(32)
	crypto.getRandomValues(seed)
	const pubHex = Buffer.from(publicKeyFromSeed(seed)).toString('hex')
	const kch = generateChannelKey()
	const wrap = wrapChannelKey(kch, pubHex)
	const unwrapped = unwrapChannelKey(wrap, seed)
	assertEquals(unwrapped, kch)
})

Deno.test('ckg message encrypt decrypt', () => {
	const kch = generateChannelKey()
	const channelId = 'general'
	const gen = 2
	const plain = JSON.stringify({ type: 'text', content: 'hello' })
	const envelope = encryptWithChannelKey(plain, kch, channelId, gen)
	assertEquals(envelope.scheme, CKG_SCHEME)
	assertEquals(typeof envelope.payload, 'string')
	assertEquals(envelope.payload.split('.').length, 3)
	const out = decryptWithChannelKey(envelope, kch, channelId)
	assertEquals(out, plain)
})

Deno.test('prior key generation still decrypts after rotate', () => {
	const k0 = generateChannelKey()
	const k1 = generateChannelKey()
	const channelId = 'ch1'
	const e0 = encryptWithChannelKey('before-rotate', k0, channelId, 0)
	const e1 = encryptWithChannelKey('after-rotate', k1, channelId, 1)
	assertEquals(decryptWithChannelKey(e0, k0, channelId), 'before-rotate')
	assertEquals(decryptWithChannelKey(e1, k1, channelId), 'after-rotate')
	assertEquals(decryptWithChannelKey(e0, k1, channelId), null)
})
