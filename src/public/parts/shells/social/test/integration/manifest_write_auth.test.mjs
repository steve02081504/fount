/**
 * 时间线 manifest 写入授权（isTimelineWriteAuthorized）边界测试。
 */
/* global Deno */
import { Buffer } from 'node:buffer'
import fs from 'node:fs'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { randomSeed } from '../federation/remote_timeline.mjs'
import { createTestSession } from '../harness.mjs'

const getSession = createTestSession()

const { isTimelineWriteAuthorized } = await import('../../src/federation/write_auth.mjs')
const append = await import('../../src/timeline/append.mjs')
const { pubKeyHash, publicKeyFromSeed, keyPairFromSeed } = await import('npm:@steve02081504/fount-p2p/crypto')
const { encodeEntityHash, entityHashFromRecoveryPubKeyHex } = await import('npm:@steve02081504/fount-p2p/core/entity_id')
const {
	ensureAgentEntityIdentity,
	getEntitySecretKey,
	getOperatorSecretKey,
	resolveOperatorEntityHashForUser,
} = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
const { getUserDictionary } = await import('fount/server/auth/index.mjs')
const { ensureEntitySocialReady } = await import('../../src/lib/bootstrap.mjs')

Deno.test('operator may write own user timeline', async () => {
	const { username } = await getSession()
	const operator = await resolveOperatorEntityHashForUser(username)
	assert(operator)
	const priorEvents = await append.readTimelineEvents(username, operator)
	const secret = new Uint8Array(Buffer.from(await getOperatorSecretKey(username), 'hex'))
	const sender = pubKeyHash(publicKeyFromSeed(secret))
	assertEquals(await isTimelineWriteAuthorized(operator, sender, { priorEvents }), true)
})

Deno.test('foreign sender cannot write operator timeline', async () => {
	const { username } = await getSession()
	const operator = await resolveOperatorEntityHashForUser(username)
	const attacker = pubKeyHash(publicKeyFromSeed(randomSeed()))
	assertEquals(await isTimelineWriteAuthorized(operator, attacker), false)
})

Deno.test('local agent active key may write own timeline with key history', async () => {
	const { username } = await getSession()
	const charPartName = 'manifest-write-agent'
	fs.mkdirSync(`${getUserDictionary(username)}/chars/${charPartName}`, { recursive: true })
	const row = await ensureAgentEntityIdentity(username, charPartName)
	await ensureEntitySocialReady(username, row.entityHash)
	const priorEvents = await append.readTimelineEvents(username, row.entityHash)
	const secret = new Uint8Array(Buffer.from(await getEntitySecretKey(username, row.entityHash), 'hex'))
	const sender = pubKeyHash(publicKeyFromSeed(secret))
	assertEquals(await isTimelineWriteAuthorized(row.entityHash, sender, { priorEvents }), true)
})

Deno.test('remote agent timeline rejects unknown sender', async () => {
	await getSession()
	const { publicKey } = keyPairFromSeed(randomSeed())
	const remoteOwner = entityHashFromRecoveryPubKeyHex('9'.repeat(64), Buffer.from(publicKey).toString('hex'))
	const stranger = pubKeyHash(publicKeyFromSeed(randomSeed()))
	assertEquals(await isTimelineWriteAuthorized(remoteOwner, stranger), false)
})

Deno.test('user-style owner accepts subjectHash sender only', async () => {
	await getSession()
	const seed = randomSeed()
	const sender = pubKeyHash(publicKeyFromSeed(seed))
	const owner = encodeEntityHash('d'.repeat(64), sender)
	assertEquals(await isTimelineWriteAuthorized(owner, sender), true)
	assertEquals(await isTimelineWriteAuthorized(owner, pubKeyHash(publicKeyFromSeed(randomSeed()))), false)
})
