import { Buffer } from 'node:buffer'

import { nextHlc } from 'npm:@steve02081504/fount-p2p/core/hlc'
import { randomKeyPair } from 'npm:@steve02081504/fount-p2p/crypto'

import {
	cabinetIdFromWritePub,
	decryptOpPayload,
	encryptOpPayload,
	signOp,
	verifyOp,
	writeIdentityFromSecret,
} from '../../src/shared/crypto.mjs'
import { materializeSharedOps } from '../../src/shared/materialize.mjs'

Deno.test('shared cabinet op sign/verify + LWW materialize', async () => {
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
	const unsigned = {
		op_id: 'op1',
		hlc: hlc1,
		gen: 0,
		entry_id: 'e1',
		action: 'upsert',
		payload_ciphertext: encryptOpPayload(entry, readKey, cabinetId, 0),
	}
	const op = await signOp(unsigned, secretKey)
	if (!await verifyOp(op, publicKey)) throw new Error('verify failed')
	if (cabinetIdFromWritePub(publicKey) !== cabinetId) throw new Error('cabinet id mismatch')

	const hlc2 = nextHlc(hlc1)
	const newer = await signOp({
		op_id: 'op2',
		hlc: hlc2,
		gen: 0,
		entry_id: 'e1',
		action: 'upsert',
		payload_ciphertext: encryptOpPayload({ ...entry, name: 'b.txt' }, readKey, cabinetId, 0),
	}, secretKey)

	const keys = { write_pubkey: Buffer.from(publicKey).toString('hex'), read_keys: [{ gen: 0, key: readKey }], current_gen: 0 }
	const { entries } = materializeSharedOps([op, newer], keys, cabinetId)
	if (entries.get('e1')?.name !== 'b.txt') throw new Error('LWW failed')

	const plain = decryptOpPayload(op.payload_ciphertext, readKey, cabinetId, 0)
	if (plain?.name !== 'a.txt') throw new Error('decrypt failed')
})

Deno.test('shared cabinet forged sig rejected', async () => {
	const a = await randomKeyPair()
	const b = await randomKeyPair()
	const forged = await signOp({
		op_id: 'x',
		hlc: nextHlc(),
		gen: 0,
		entry_id: 'e',
		action: 'delete',
		payload_ciphertext: null,
	}, b.secretKey)
	if (await verifyOp(forged, a.publicKey)) throw new Error('forged accepted')
})
