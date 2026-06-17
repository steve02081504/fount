/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { verifyRemoteCheckpoint } from '../checkpoint.mjs'

Deno.test('verifyRemoteCheckpoint rejects missing checkpoint', async () => {
	const result = await verifyRemoteCheckpoint(null)
	assertEquals(result.valid, false)
	assertEquals(result.reason, 'checkpoint missing or not an object')
})

Deno.test('verifyRemoteCheckpoint rejects empty eventIdsInEpoch', async () => {
	const result = await verifyRemoteCheckpoint({
		eventIdsInEpoch: [],
		epoch_root_hash: 'a'.repeat(64),
		checkpoint_signature: 'b'.repeat(128),
		epoch_id: 1,
	})
	assertEquals(result.valid, false)
	assertEquals(result.reason, 'eventIdsInEpoch missing or empty')
})

Deno.test('verifyRemoteCheckpoint rejects merkle mismatch', async () => {
	const result = await verifyRemoteCheckpoint({
		eventIdsInEpoch: ['a'.repeat(64)],
		epoch_root_hash: 'b'.repeat(64),
		checkpoint_signature: 'c'.repeat(128),
		epoch_id: 1,
		members_record: { members: {}, roles: {} },
	})
	assertEquals(result.valid, false)
	assertEquals(result.reason, 'epoch_root_hash does not match Merkle root of eventIdsInEpoch')
})
