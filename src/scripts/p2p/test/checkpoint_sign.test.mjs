/* global Deno */
import { Buffer } from 'node:buffer'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	isSignedCheckpoint,
	signCheckpoint,
	verifyCheckpointSignature,
} from '../checkpoint_sign.mjs'
import { keyPairFromSeed } from '../crypto.mjs'

Deno.test('signCheckpoint roundtrip verifies', async () => {
	const { publicKey, secretKey } = keyPairFromSeed(Buffer.alloc(32, 3))
	const payload = {
		eventIdsInEpoch: ['a'.repeat(64)],
		epoch_root_hash: 'b'.repeat(64),
		epoch_id: 1,
	}
	const signed = await signCheckpoint(payload, secretKey)
	assertEquals(isSignedCheckpoint(signed), true)
	assertEquals(await verifyCheckpointSignature(signed, publicKey), true)
})

Deno.test('verifyCheckpointSignature rejects tampered signature', async () => {
	const { publicKey, secretKey } = keyPairFromSeed(Buffer.alloc(32, 5))
	const signed = await signCheckpoint({ epoch_id: 2 }, secretKey)
	const bad = { ...signed, checkpoint_signature: 'c'.repeat(128) }
	assertEquals(await verifyCheckpointSignature(bad, publicKey), false)
})

Deno.test('isSignedCheckpoint rejects missing signature', () => {
	assertEquals(isSignedCheckpoint({ epoch_id: 1 }), false)
	assertEquals(isSignedCheckpoint(null), false)
})
