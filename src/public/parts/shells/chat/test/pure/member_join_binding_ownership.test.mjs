/**
 * member_join：bindingSig 合法但 active 钥不属于 entityHash 时拒绝。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { Buffer } from 'node:buffer'

import { keyPairFromSeed } from 'npm:@steve02081504/fount-p2p/crypto'
import { normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'

import { checkEventPermission } from '../../src/chat/dag/authorizeEvent.mjs'
import {
	buildMemberJoinBinding,
	verifyEntityActivePubKeyBelongs,
	verifyMemberJoinBinding,
} from '../../src/chat/dag/entityBinding.mjs'

const ENTITY = `${'a'.repeat(64)}${'b'.repeat(64)}`
const MEMBER = 'c'.repeat(64)

Deno.test('verifyMemberJoinBinding accepts self-signed claim without ownership proof', async () => {
	const attacker = keyPairFromSeed(new Uint8Array(32).fill(7))
	const pub = Buffer.from(attacker.publicKey).toString('hex')
	const { bindingSig } = await buildMemberJoinBinding({
		entityHash: ENTITY,
		memberPubKeyHash: MEMBER,
		entityActiveSecretKey: attacker.secretKey,
	})
	assertEquals(await verifyMemberJoinBinding({
		entityHash: ENTITY,
		memberPubKeyHash: MEMBER,
		bindingSig,
		entityActivePubKeyHex: pub,
	}), true)
})

Deno.test('verifyEntityActivePubKeyBelongs rejects empty username', async () => {
	const attacker = keyPairFromSeed(new Uint8Array(32).fill(9))
	const pub = normalizeHex64(Buffer.from(attacker.publicKey).toString('hex'))
	const result = await verifyEntityActivePubKeyBelongs('', ENTITY, pub)
	assertEquals(result.ok, false)
})

Deno.test('checkEventPermission member_join rejects spoofed entity without ownership', async () => {
	const attacker = keyPairFromSeed(new Uint8Array(32).fill(3))
	const pub = normalizeHex64(Buffer.from(attacker.publicKey).toString('hex'))
	const { bindingSig } = await buildMemberJoinBinding({
		entityHash: ENTITY,
		memberPubKeyHash: MEMBER,
		entityActiveSecretKey: attacker.secretKey,
	})
	const result = await checkEventPermission(
		{ members: {}, groupSettings: {} },
		{
			type: 'member_join',
			content: {
				entityHash: ENTITY,
				entityActivePubKeyHex: pub,
				bindingSig,
			},
		},
		MEMBER,
		{ username: '' },
	)
	assertEquals(result.ok, false)
})
