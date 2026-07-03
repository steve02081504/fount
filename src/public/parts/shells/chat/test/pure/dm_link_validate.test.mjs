/**
 * dm/linkValidate 单测。
 * 复测：deno test --no-check --allow-all src/public/parts/shells/chat/test/pure/dm_link_validate.test.mjs
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	findMemberIdByPubKeyHex,
	validateDmIntroLinkProof,
} from '../../src/chat/dm/linkValidate.mjs'

const PUB_HEX = 'f'.repeat(64)

Deno.test('findMemberIdByPubKeyHex resolves member by pubKeyHex', () => {
	const state = {
		members: {
			alice: { pubKeyHex: PUB_HEX, status: 'active' },
		},
	}
	assertEquals(findMemberIdByPubKeyHex(state, PUB_HEX), 'alice')
	assertEquals(findMemberIdByPubKeyHex(state, '0'.repeat(64)), null)
})

Deno.test('validateDmIntroLinkProof rejects malformed inputs', async () => {
	const state = { members: {} }
	const badPk = await validateDmIntroLinkProof('u', state, 'short', 'nonce123456789012', '0'.repeat(128))
	assertEquals(badPk.ok, false)
	const badNonce = await validateDmIntroLinkProof('u', state, PUB_HEX, 'x', '0'.repeat(128))
	assertEquals(badNonce.ok, false)
	const badSig = await validateDmIntroLinkProof('u', state, PUB_HEX, 'nonce123456789012', 'bad')
	assertEquals(badSig.ok, false)
})
