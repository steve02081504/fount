/* global Deno */
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { keyPairFromSeed } from '../../crypto.mjs'
import {
	activeSenderHashFromPubKeyHex,
	createGenesisKeyHistory,
	foldOperatorKeyHistoryFromEvents,
	isOperatorTimelineWriteAuthorized,
	isRecoverySender,
	isValidActiveSender,
	recoverySubjectHashFromPubKeyHex,
} from '../../operator_key_chain.mjs'

Deno.test('recovery subject anchors entity identity', () => {
	const recovery = keyPairFromSeed(randomBytes(32))
	const active = keyPairFromSeed(randomBytes(32))
	const recoveryHex = Buffer.from(recovery.publicKey).toString('hex')
	const activeHex = Buffer.from(active.publicKey).toString('hex')
	const subject = recoverySubjectHashFromPubKeyHex(recoveryHex)
	assertEquals(subject, recoverySubjectHashFromPubKeyHex(recoveryHex))
	assertEquals(isRecoverySender(recoveryHex, subject), true)
	assertEquals(isValidActiveSender(createGenesisKeyHistory(recoveryHex, activeHex), recoveryHex, activeSenderHashFromPubKeyHex(activeHex)), true)
})

Deno.test('foldOperatorKeyHistoryFromEvents tracks rotate', () => {
	const recovery = keyPairFromSeed(randomBytes(32))
	const active = keyPairFromSeed(randomBytes(32))
	const recoveryHex = Buffer.from(recovery.publicKey).toString('hex')
	const activeHex = Buffer.from(active.publicKey).toString('hex')
	const events = [
		{ type: 'social_meta', content: { recoveryPubKeyHex: recoveryHex } },
		{ type: 'operator_key_rotate', content: { generation: 0, activePubKeyHex: activeHex }, hlc: { wall: 1 }, timestamp: 1 },
	]
	const folded = foldOperatorKeyHistoryFromEvents(events)
	assertEquals(folded.recoveryPubKeyHex, recoveryHex)
	assertEquals(folded.operatorKeyHistory.length, 1)
	assertEquals(isOperatorTimelineWriteAuthorized({
		entityHash: 'a'.repeat(128),
		sender: activeSenderHashFromPubKeyHex(activeHex),
		eventType: 'post',
		eventContent: {},
		recoveryPubKeyHex: recoveryHex,
		operatorKeyHistory: folded.operatorKeyHistory,
	}), true)
})
