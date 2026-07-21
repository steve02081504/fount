/**
 * 联邦入站边界（untrusted ingress）。
 * ingestRemoteTimelineEvent 的校验：类型白名单 / eventId 自洽 / 验签 / 去重 / blocklist；
 * canonicalizeSignedTimelineEvent + validateRemoteEventShape 的形状校验；
 * 以及 owner↔author 绑定边界探测。
 */
/* global Deno */
import { Buffer } from 'node:buffer'
import fs from 'node:fs'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { makeRemoteSignedEvent, randomSeed } from '../federation/remote_timeline.mjs'
import { createTestSession } from '../harness.mjs'

const getSession = createTestSession()

const sync = await import('../../src/timeline/sync.mjs')
const append = await import('../../src/timeline/append.mjs')
const canon = await import('../../src/timeline/canonicalizeEvent.mjs')
const { addDenylistEntry, loadDenylist, saveDenylist } = await import('npm:@steve02081504/fount-p2p/node/denylist')
const { pubKeyHash, publicKeyFromSeed } = await import('npm:@steve02081504/fount-p2p/crypto')
const { encodeEntityHash, entityHashFromRecoveryPubKeyHex } = await import('npm:@steve02081504/fount-p2p/core/entity_id')
const { getNodeHash } = await import('npm:@steve02081504/fount-p2p/node/identity')
const {
	ensureAgentEntityIdentity,
	getEntitySecretKey,
	getOperatorSecretKey,
	resolveOperatorEntityHashForUser,
} = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
const { getUserDictionary } = await import('fount/server/auth/index.mjs')
const { ensureEntitySocialReady } = await import('../../src/lib/bootstrap.mjs')

/**
 * 为给定种子构造一个 user 风格的 owner entityHash（nodeHash 任意 + sender subjectHash）。
 * @param {Uint8Array} seed 32 字节种子
 * @param {string} [nodeHashHex] owner nodeHash（默认任意值）
 * @returns {string} 128 位 owner entityHash
 */
function ownerForSeed(seed, nodeHashHex = 'd'.repeat(64)) {
	const sender = pubKeyHash(publicKeyFromSeed(seed))
	return encodeEntityHash(nodeHashHex, sender)
}

Deno.test('valid remote post is ingested and visible', async () => {
	const { username } = await getSession()
	const seed = randomSeed()
	const owner = ownerForSeed(seed)
	const event = await makeRemoteSignedEvent(seed, owner, {
		type: 'post',
		content: { text: 'remote hello', visibility: 'public' },
	})
	assertEquals(await sync.ingestRemoteTimelineEvent(username, owner, event), true)
	const events = await append.readTimelineEvents(username, owner)
	assert(events.some(e => e.id === event.id))
})

Deno.test('dedup: re-ingest same event returns true (idempotent)', async () => {
	const { username } = await getSession()
	const seed = randomSeed()
	const owner = ownerForSeed(seed)
	const event = await makeRemoteSignedEvent(seed, owner, {
		type: 'post', content: { text: 'dup', visibility: 'public' },
	})
	assertEquals(await sync.ingestRemoteTimelineEvent(username, owner, event), true)
	assertEquals(await sync.ingestRemoteTimelineEvent(username, owner, event), true)
})

Deno.test('non-whitelisted event type is rejected', async () => {
	const { username } = await getSession()
	const seed = randomSeed()
	const owner = ownerForSeed(seed)
	const event = await makeRemoteSignedEvent(seed, owner, {
		type: 'channel_key_rotate', content: { x: 1 },
	})
	assertEquals(await sync.ingestRemoteTimelineEvent(username, owner, event), false)
})

Deno.test('eventId tampering is rejected', async () => {
	const { username } = await getSession()
	const seed = randomSeed()
	const owner = ownerForSeed(seed)
	const event = await makeRemoteSignedEvent(seed, owner, {
		type: 'post', content: { text: 'tamper id', visibility: 'public' },
	})
	const tampered = { ...event, content: { text: 'mutated', visibility: 'public' } }
	assertEquals(await sync.ingestRemoteTimelineEvent(username, owner, tampered), false)
})

Deno.test('signature tampering is rejected', async () => {
	const { username } = await getSession()
	const seed = randomSeed()
	const owner = ownerForSeed(seed)
	const event = await makeRemoteSignedEvent(seed, owner, {
		type: 'post', content: { text: 'bad sig', visibility: 'public' },
	})
	const flipped = event.signature.startsWith('0') ? `1${event.signature.slice(1)}` : `0${event.signature.slice(1)}`
	const tampered = { ...event, signature: flipped }
	assertEquals(await sync.ingestRemoteTimelineEvent(username, owner, tampered), false)
})

Deno.test('senderPubKey not matching sender hash is rejected', async () => {
	const { username } = await getSession()
	const seed = randomSeed()
	const owner = ownerForSeed(seed)
	const event = await makeRemoteSignedEvent(seed, owner, {
		type: 'post', content: { text: 'pk mismatch', visibility: 'public' },
	})
	const otherPub = Buffer.from(publicKeyFromSeed(randomSeed())).toString('hex')
	const tampered = { ...event, senderPubKey: otherPub }
	assertEquals(await sync.ingestRemoteTimelineEvent(username, owner, tampered), false)
})

Deno.test('blocked sender (pubKeyHash) is rejected', async () => {
	const { username } = await getSession()
	const seed = randomSeed()
	const owner = ownerForSeed(seed)
	const sender = pubKeyHash(publicKeyFromSeed(seed))
	const blocklistBefore = loadDenylist()
	await addDenylistEntry({ scope: 'subject', value: sender })
	try {
		const event = await makeRemoteSignedEvent(seed, owner, {
			type: 'post', content: { text: 'blocked', visibility: 'public' },
		})
		assertEquals(await sync.ingestRemoteTimelineEvent(username, owner, event), false)
	}
	finally {
		saveDenylist(blocklistBefore)
	}
})

Deno.test('validateRemoteEventShape rejects malformed events', () => {
	const base = {
		type: 'post', id: 'a'.repeat(64), prev_event_ids: [], sender: 'b'.repeat(64),
	}
	// good shape passes
	canon.canonicalizeSignedTimelineEvent({ ...base, content: {}, groupId: 'g', hlc: { wall: 1 } })

	for (const bad of [
		{ ...base, id: 'xyz' },
		{ ...base, prev_event_ids: 'nope' },
		{ ...base, sender: 'short' },
		{ ...base, type: '' },
	]) {
		let threw = false
		try { canon.canonicalizeSignedTimelineEvent(bad) }
		catch { threw = true }
		assert(threw, `expected throw for ${JSON.stringify(bad).slice(0, 40)}`)
	}
})

// ---- 信任边界 ----

// 回归：groupId 必须与归档的 owner 时间线一致（已修复）。
Deno.test('groupId mismatching owner timeline is rejected (regression for fix)', async () => {
	const { username } = await getSession()
	const seed = randomSeed()
	const realOwner = ownerForSeed(seed)
	// 事件 groupId 绑定 realOwner，却塞进另一个 owner 的路径 → 应拒绝
	const otherOwner = ownerForSeed(seed, getNodeHash())
	const event = await makeRemoteSignedEvent(seed, realOwner, {
		type: 'post', content: { text: 'group mismatch', visibility: 'public' },
	})
	assertEquals(await sync.ingestRemoteTimelineEvent(username, otherOwner, event), false)
})

// ---- 写入授权（已修复：sender 必须有权写入目标时间线） ----

// 回归（核心攻击面）：攻击者用自有 key 自洽签名、把 groupId 伪造成受害者 user 时间线，
// 试图把“伪造帖”注入受害者时间线 → 必须被拒绝（sender !== 受害者 subjectHash）。
Deno.test('foreign-key injection into a user-style owner timeline is rejected', async () => {
	const { username } = await getSession()
	const attackerSeed = randomSeed()
	// 受害者：user 型 owner（subjectHash 即其本人 pubKeyHash，与攻击者无关）
	const victimSubject = 'f'.repeat(64)
	const victimOwner = encodeEntityHash('e'.repeat(64), victimSubject)
	const attackerSender = pubKeyHash(publicKeyFromSeed(attackerSeed))
	assert(attackerSender !== victimSubject, 'sanity: attacker sender differs from victim subjectHash')
	// 攻击者把 groupId 设成受害者时间线（自洽签名可绕过 groupId 绑定），用自己的 key 签名
	const event = await makeRemoteSignedEvent(attackerSeed, victimOwner, {
		type: 'post', content: { text: 'INJECTED into victim timeline', visibility: 'public' },
	})
	assertEquals(await sync.ingestRemoteTimelineEvent(username, victimOwner, event), false)
	// 受害者时间线不得出现伪造帖
	const events = await append.readTimelineEvents(username, victimOwner)
	assert(!events.some(e => e.id === event.id), 'forged event must not be archived')
})

// user 型正例：sender === subjectHash 时合法写入被接受（与攻击例对照）。
Deno.test('legit user-owned write (sender === subjectHash) is accepted', async () => {
	const { username } = await getSession()
	const seed = randomSeed()
	const owner = ownerForSeed(seed) // subjectHash === pubKeyHash(seed) === sender
	const event = await makeRemoteSignedEvent(seed, owner, {
		type: 'post', content: { text: 'legit owner post', visibility: 'public' },
	})
	assertEquals(await sync.ingestRemoteTimelineEvent(username, owner, event), true)
})

// agent 型正例：本机 agent 身份 + social_meta 创世后，用 agent 活跃钥签名写入。
Deno.test('agent-key-signed write to a local agent timeline is accepted', async () => {
	const { username } = await getSession()
	const charPartName = 'social-test-agent'
	fs.mkdirSync(`${getUserDictionary(username)}/chars/${charPartName}`, { recursive: true })
	const row = await ensureAgentEntityIdentity(username, charPartName)
	await ensureEntitySocialReady(username, row.entityHash)
	const agentSecret = new Uint8Array(Buffer.from(await getEntitySecretKey(username, row.entityHash), 'hex'))
	const event = await makeRemoteSignedEvent(agentSecret, row.entityHash, {
		type: 'post', charPartName, content: { text: 'agent post by agent key', visibility: 'public' },
	})
	assertEquals(await sync.ingestRemoteTimelineEvent(username, row.entityHash, event), true)
})

// agent 型攻击例：陌生 key 代签本机 agent 实体 → 拒绝。
Deno.test('foreign-key injection into a locally-hosted agent timeline is rejected', async () => {
	const { username } = await getSession()
	const charPartName = 'social-test-agent'
	fs.mkdirSync(`${getUserDictionary(username)}/chars/${charPartName}`, { recursive: true })
	const row = await ensureAgentEntityIdentity(username, charPartName)
	await ensureEntitySocialReady(username, row.entityHash)
	const attackerSeed = randomSeed()
	const event = await makeRemoteSignedEvent(attackerSeed, row.entityHash, {
		type: 'post', charPartName, content: { text: 'INJECTED agent post', visibility: 'public' },
	})
	assertEquals(await sync.ingestRemoteTimelineEvent(username, row.entityHash, event), false)
})

// 远端节点 agent：先 ingest recovery 签创世链，再以活跃钥发帖 → 引导成功。
Deno.test('remote agent timeline bootstraps via recovery genesis then accepts active-key post', async () => {
	const { username } = await getSession()
	const remoteNodeHash = '7'.repeat(64)
	const recoverySeed = randomSeed()
	const activeSeed = randomSeed()
	const recoveryPub = Buffer.from(publicKeyFromSeed(recoverySeed)).toString('hex')
	const activePub = Buffer.from(publicKeyFromSeed(activeSeed)).toString('hex')
	const remoteAgentOwner = entityHashFromRecoveryPubKeyHex(remoteNodeHash, recoveryPub)

	const socialMeta = await makeRemoteSignedEvent(recoverySeed, remoteAgentOwner, {
		type: 'social_meta',
		content: {
			hideFromDiscovery: false,
			createdAt: Date.now(),
			recoveryPubKeyHex: recoveryPub,
		},
	})
	assertEquals(await sync.ingestRemoteTimelineEvent(username, remoteAgentOwner, socialMeta), true)

	const rotate = await makeRemoteSignedEvent(recoverySeed, remoteAgentOwner, {
		type: 'entity_key_rotate',
		prev_event_ids: [socialMeta.id],
		content: {
			generation: 0,
			activePubKeyHex: activePub,
			prevGeneration: null,
		},
	})
	assertEquals(await sync.ingestRemoteTimelineEvent(username, remoteAgentOwner, rotate), true)

	const post = await makeRemoteSignedEvent(activeSeed, remoteAgentOwner, {
		type: 'post',
		prev_event_ids: [rotate.id],
		content: { text: 'remote agent post', visibility: 'public' },
	})
	assertEquals(await sync.ingestRemoteTimelineEvent(username, remoteAgentOwner, post), true)
	const events = await append.readTimelineEvents(username, remoteAgentOwner)
	assert(events.some(e => e.id === post.id))
})

// 远端 agent 已引导后，陌生钥注入仍拒绝。
Deno.test('foreign-key injection into a bootstrapped remote agent timeline is rejected', async () => {
	const { username } = await getSession()
	const remoteNodeHash = '8'.repeat(64)
	const recoverySeed = randomSeed()
	const activeSeed = randomSeed()
	const recoveryPub = Buffer.from(publicKeyFromSeed(recoverySeed)).toString('hex')
	const activePub = Buffer.from(publicKeyFromSeed(activeSeed)).toString('hex')
	const remoteAgentOwner = entityHashFromRecoveryPubKeyHex(remoteNodeHash, recoveryPub)

	const socialMeta = await makeRemoteSignedEvent(recoverySeed, remoteAgentOwner, {
		type: 'social_meta',
		content: {
			hideFromDiscovery: false,
			createdAt: Date.now(),
			recoveryPubKeyHex: recoveryPub,
		},
	})
	assertEquals(await sync.ingestRemoteTimelineEvent(username, remoteAgentOwner, socialMeta), true)
	const rotate = await makeRemoteSignedEvent(recoverySeed, remoteAgentOwner, {
		type: 'entity_key_rotate',
		prev_event_ids: [socialMeta.id],
		content: { generation: 0, activePubKeyHex: activePub, prevGeneration: null },
	})
	assertEquals(await sync.ingestRemoteTimelineEvent(username, remoteAgentOwner, rotate), true)

	const forged = await makeRemoteSignedEvent(randomSeed(), remoteAgentOwner, {
		type: 'post',
		prev_event_ids: [rotate.id],
		content: { text: 'INJECTED remote agent post', visibility: 'public' },
	})
	assertEquals(await sync.ingestRemoteTimelineEvent(username, remoteAgentOwner, forged), false)
	const events = await append.readTimelineEvents(username, remoteAgentOwner)
	assert(!events.some(e => e.id === forged.id), 'forged event must not be archived')
})

// owner 活跃钥签 post_delete 写入本机 agent 时间线 → 接受（联邦复核路径）。
Deno.test('owner-signed post_delete on local agent timeline is accepted', async () => {
	const { username } = await getSession()
	const charPartName = 'social-owner-delete-agent'
	fs.mkdirSync(`${getUserDictionary(username)}/chars/${charPartName}`, { recursive: true })
	const row = await ensureAgentEntityIdentity(username, charPartName)
	const operator = await resolveOperatorEntityHashForUser(username)
	await ensureEntitySocialReady(username, operator)
	await ensureEntitySocialReady(username, row.entityHash)
	const post = await append.appendTimelineEvent(username, row.entityHash, {
		type: 'post',
		charPartName,
		content: { text: 'agent post to delete', visibility: 'public' },
	})
	const ownerSecret = new Uint8Array(Buffer.from(await getOperatorSecretKey(username), 'hex'))
	const event = await makeRemoteSignedEvent(ownerSecret, row.entityHash, {
		type: 'post_delete',
		content: { targetPostId: post.id },
	})
	assertEquals(await sync.ingestRemoteTimelineEvent(username, row.entityHash, event), true)
})

// 陌生钥签 post_delete → 拒绝。
Deno.test('stranger-signed post_delete on local agent timeline is rejected', async () => {
	const { username } = await getSession()
	const charPartName = 'social-owner-delete-deny'
	fs.mkdirSync(`${getUserDictionary(username)}/chars/${charPartName}`, { recursive: true })
	const row = await ensureAgentEntityIdentity(username, charPartName)
	const operator = await resolveOperatorEntityHashForUser(username)
	await ensureEntitySocialReady(username, operator)
	await ensureEntitySocialReady(username, row.entityHash)
	const event = await makeRemoteSignedEvent(randomSeed(), row.entityHash, {
		type: 'post_delete',
		content: { targetPostId: 'a'.repeat(64) },
	})
	assertEquals(await sync.ingestRemoteTimelineEvent(username, row.entityHash, event), false)
})
