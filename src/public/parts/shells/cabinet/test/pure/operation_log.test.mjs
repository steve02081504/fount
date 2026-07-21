/* global Deno */
import { Buffer } from 'node:buffer'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { nextHlc } from 'npm:@steve02081504/fount-p2p/core/hlc'
import { randomKeyPair } from 'npm:@steve02081504/fount-p2p/crypto'

import {
	cabinetIdFromWritePub,
	decryptOperationPayload,
	encryptOperationPayload,
	signOperation,
	verifyOperation,
	writeIdentityFromSecret,
} from '../../src/shared/crypto.mjs'
import { materializeSharedOperations } from '../../src/shared/materialize.mjs'

Deno.test('shared cabinet operation sign/verify + LWW materialize', async () => {
	const { secretKey, publicKey } = await randomKeyPair()
	const { cabinetId } = writeIdentityFromSecret(secretKey)
	const readKey = Buffer.alloc(32, 7).toString('hex')
	const entry = {
		id: 'e1',
		name: 'a.txt',
		kind: 'file',
		parent_id: null,
		size: 1,
		mime_type: 'text/plain',
	}
	const hlc1 = nextHlc()
	const operation = await signOperation({
		operation_id: 'op1',
		hlc: hlc1,
		gen: 0,
		entry_id: 'e1',
		action: 'upsert',
		payload_ciphertext: encryptOperationPayload(entry, readKey, cabinetId, 0),
	}, secretKey)
	assertEquals(await verifyOperation(operation, publicKey), true)
	assertEquals(cabinetIdFromWritePub(publicKey), cabinetId)

	const newer = await signOperation({
		operation_id: 'op2',
		hlc: nextHlc(hlc1),
		gen: 0,
		entry_id: 'e1',
		action: 'upsert',
		payload_ciphertext: encryptOperationPayload({ ...entry, name: 'b.txt' }, readKey, cabinetId, 0),
	}, secretKey)

	const keys = {
		write_pubkey: Buffer.from(publicKey).toString('hex'),
		read_keys: [{ gen: 0, key: readKey }],
		current_gen: 0,
	}
	const { entries } = materializeSharedOperations([operation, newer], keys, cabinetId)
	assertEquals(entries.get('e1')?.name, 'b.txt')
	assertEquals(
		decryptOperationPayload(operation.payload_ciphertext, readKey, cabinetId, 0)?.name,
		'a.txt',
	)
})

Deno.test('shared cabinet forged sig rejected', async () => {
	const a = await randomKeyPair()
	const b = await randomKeyPair()
	assertEquals(await verifyOperation(await signOperation({
		operation_id: 'x',
		hlc: nextHlc(),
		gen: 0,
		entry_id: 'e',
		action: 'delete',
		payload_ciphertext: null,
	}, b.secretKey), a.publicKey), false)
})
