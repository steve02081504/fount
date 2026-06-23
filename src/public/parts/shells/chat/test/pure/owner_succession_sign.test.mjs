/**
 * owner_succession 选票签名单测。
 * 复测：deno test --no-check --allow-all src/public/parts/shells/chat/test/owner_succession_sign.test.mjs
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { publicKeyFromSeed, sign, verify } from '../../../../../../scripts/p2p/crypto.mjs'
import { ownerSuccessionBallotSignBytes } from '../../../../../../scripts/p2p/owner_succession_ballot.mjs'

Deno.test('owner succession ballot sign bytes verify roundtrip', async () => {
	const seed = new Uint8Array(32).fill(9)
	const ballot = {
		proposedOwnerPubKeyHash: 'a'.repeat(64),
		groupId: 'g-owner-succ',
		ballotId: 'b'.repeat(64),
	}
	const message = ownerSuccessionBallotSignBytes(ballot)
	const signature = await sign(message, seed)
	const pubKey = publicKeyFromSeed(seed)
	assert(await verify(signature, message, pubKey))
	assertEquals(Buffer.from(pubKey).toString('hex').length, 64)
})
