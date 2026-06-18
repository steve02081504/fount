/**
 * 时间线 manifest 写入授权（isTimelineWriteAuthorized）边界测试。
 */
/* global Deno */
import { Buffer } from 'node:buffer'
import fs from 'node:fs'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { bootstrap, randomSeed } from './harness.mjs'

const { username } = await bootstrap()

const { isTimelineWriteAuthorized } = await import('../src/timeline/writeAuth.mjs')
const { pubKeyHash, publicKeyFromSeed } = await import('../../../../../scripts/p2p/crypto.mjs')
const { agentEntityHash, encodeEntityHash } = await import('../../../../../scripts/p2p/entity_id.mjs')
const { getNodeHash } = await import('../../../../../scripts/p2p/node/identity.mjs')
const { getOperatorSecretKey } = await import('../../../../../server/p2p_server/operator_identity.mjs')
const { resolveOperatorEntityHashForUser } = await import('../../../../../server/p2p_server/operator_identity.mjs')
const { getUserDictionary } = await import('../../../../../server/auth.mjs')

Deno.test('batch13: operator may write own user timeline', async () => {
	const operator = await resolveOperatorEntityHashForUser(username)
	assert(operator)
	const secret = new Uint8Array(Buffer.from(await getOperatorSecretKey(username), 'hex'))
	const sender = pubKeyHash(publicKeyFromSeed(secret))
	assertEquals(await isTimelineWriteAuthorized(operator, sender), true)
})

Deno.test('batch13: foreign sender cannot write operator timeline', async () => {
	const operator = await resolveOperatorEntityHashForUser(username)
	const attacker = pubKeyHash(publicKeyFromSeed(randomSeed()))
	assertEquals(await isTimelineWriteAuthorized(operator, attacker), false)
})

Deno.test('batch13: operator may write locally-hosted agent timeline', async () => {
	const nodeHash = getNodeHash()
	const charPartName = 'batch13-agent'
	fs.mkdirSync(`${getUserDictionary(username)}/chars/${charPartName}`, { recursive: true })
	const agentOwner = agentEntityHash(nodeHash, `chars/${charPartName}`)
	const operatorSecret = new Uint8Array(Buffer.from(await getOperatorSecretKey(username), 'hex'))
	const operatorSender = pubKeyHash(publicKeyFromSeed(operatorSecret))
	assertEquals(await isTimelineWriteAuthorized(agentOwner, operatorSender), true)
})

Deno.test('batch13: remote agent timeline rejects unknown sender', async () => {
	const remoteOwner = agentEntityHash('9'.repeat(64), 'chars/remote-only')
	const stranger = pubKeyHash(publicKeyFromSeed(randomSeed()))
	assertEquals(await isTimelineWriteAuthorized(remoteOwner, stranger), false)
})

Deno.test('batch13: user-style owner accepts subjectHash sender only', async () => {
	const seed = randomSeed()
	const sender = pubKeyHash(publicKeyFromSeed(seed))
	const owner = encodeEntityHash('d'.repeat(64), sender)
	assertEquals(await isTimelineWriteAuthorized(owner, sender), true)
	assertEquals(await isTimelineWriteAuthorized(owner, pubKeyHash(publicKeyFromSeed(randomSeed()))), false)
})
