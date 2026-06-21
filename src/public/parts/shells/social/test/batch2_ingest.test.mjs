/**
 * Batch 2：联邦入站边界（untrusted ingress）。
 * ingestRemoteTimelineEvent 的校验：类型白名单 / eventId 自洽 / 验签 / 去重 / blocklist；
 * canonicalizeSignedTimelineEvent + validateRemoteEventShape 的形状校验；
 * 以及 owner↔author 绑定边界探测。
 */
/* global Deno */
import { Buffer } from 'node:buffer'
import fs from 'node:fs'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { bootstrap, makeRemoteSignedEvent, randomSeed } from './harness.mjs'

const { username } = await bootstrap()

const sync = await import('../src/timeline/sync.mjs')
const append = await import('../src/timeline/append.mjs')
const canon = await import('../src/timeline/canonicalizeEvent.mjs')
const { addBlocklistEntry, loadBlocklist, saveBlocklist } = await import('../../../../../scripts/p2p/blocklist.mjs')
const { pubKeyHash, publicKeyFromSeed } = await import('../../../../../scripts/p2p/crypto.mjs')
const { agentEntityHash, encodeEntityHash } = await import('../../../../../scripts/p2p/entity_id.mjs')
const { getNodeHash } = await import('../../../../../scripts/p2p/node/identity.mjs')
const { getOperatorSecretKey } = await import('../../../../../server/p2p_server/operator_identity.mjs')
const { getUserDictionary } = await import('../../../../../server/auth.mjs')

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

Deno.test('dedup: re-ingest same event returns false', async () => {
	const seed = randomSeed()
	const owner = ownerForSeed(seed)
	const event = await makeRemoteSignedEvent(seed, owner, {
		type: 'post', content: { text: 'dup', visibility: 'public' },
	})
	assertEquals(await sync.ingestRemoteTimelineEvent(username, owner, event), true)
	assertEquals(await sync.ingestRemoteTimelineEvent(username, owner, event), false)
})

Deno.test('non-whitelisted event type is rejected', async () => {
	const seed = randomSeed()
	const owner = ownerForSeed(seed)
	const event = await makeRemoteSignedEvent(seed, owner, {
		type: 'channel_key_rotate', content: { x: 1 },
	})
	assertEquals(await sync.ingestRemoteTimelineEvent(username, owner, event), false)
})

Deno.test('eventId tampering is rejected', async () => {
	const seed = randomSeed()
	const owner = ownerForSeed(seed)
	const event = await makeRemoteSignedEvent(seed, owner, {
		type: 'post', content: { text: 'tamper id', visibility: 'public' },
	})
	const tampered = { ...event, content: { text: 'mutated', visibility: 'public' } }
	assertEquals(await sync.ingestRemoteTimelineEvent(username, owner, tampered), false)
})

Deno.test('signature tampering is rejected', async () => {
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
	const seed = randomSeed()
	const owner = ownerForSeed(seed)
	const sender = pubKeyHash(publicKeyFromSeed(seed))
	const blocklistBefore = loadBlocklist()
	await addBlocklistEntry({ scope: 'subject', value: sender })
	try {
		const event = await makeRemoteSignedEvent(seed, owner, {
			type: 'post', content: { text: 'blocked', visibility: 'public' },
		})
		assertEquals(await sync.ingestRemoteTimelineEvent(username, owner, event), false)
	}
	finally {
		saveBlocklist(blocklistBefore)
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
	const seed = randomSeed()
	const owner = ownerForSeed(seed) // subjectHash === pubKeyHash(seed) === sender
	const event = await makeRemoteSignedEvent(seed, owner, {
		type: 'post', content: { text: 'legit owner post', visibility: 'public' },
	})
	assertEquals(await sync.ingestRemoteTimelineEvent(username, owner, event), true)
})

// agent 型正例：本机托管 agent 实体 + 由本节点 operator（federation identity）代签 → 接受。
// agent 无独立私钥，靠托管节点 operator 身份绑定证明写入权（本机可解析该绑定）。
Deno.test('operator-signed write to a locally-hosted agent timeline is accepted', async () => {
	const nodeHash = getNodeHash()
	// 在测试用户目录下放一个 chars/ 目录，使其成为本机托管 agent 实体
	const charPartName = 'social-test-agent'
	fs.mkdirSync(`${getUserDictionary(username)}/chars/${charPartName}`, { recursive: true })
	const agentOwner = agentEntityHash(nodeHash, `chars/${charPartName}`)
	// 用 operator 的 federation identity 私钥代签（sender === operator subjectHash，而非 agent subjectHash）
	const operatorSecret = new Uint8Array(Buffer.from(await getOperatorSecretKey(username), 'hex'))
	const event = await makeRemoteSignedEvent(operatorSecret, agentOwner, {
		type: 'post', charId: charPartName, content: { text: 'agent post by operator', visibility: 'public' },
	})
	assertEquals(await sync.ingestRemoteTimelineEvent(username, agentOwner, event), true)
})

// agent 型攻击例：陌生 key 代签本机 agent 实体 → 拒绝（sender 非该节点 operator）。
Deno.test('foreign-key injection into a locally-hosted agent timeline is rejected', async () => {
	const nodeHash = getNodeHash()
	const charPartName = 'social-test-agent' // 复用上一用例创建的本机 agent
	fs.mkdirSync(`${getUserDictionary(username)}/chars/${charPartName}`, { recursive: true })
	const agentOwner = agentEntityHash(nodeHash, `chars/${charPartName}`)
	const attackerSeed = randomSeed()
	const event = await makeRemoteSignedEvent(attackerSeed, agentOwner, {
		type: 'post', charId: charPartName, content: { text: 'INJECTED agent post', visibility: 'public' },
	})
	assertEquals(await sync.ingestRemoteTimelineEvent(username, agentOwner, event), false)
})

// agent 型架构边界：远端节点托管的 agent 时间线事件，本机无法解析 operator 绑定 → 拒绝。
// （当前架构缺少跨节点 nodeHash → operator 身份公告链，详见 README 架构问题。）
Deno.test('remote (non-local) agent timeline event cannot be authorized → rejected', async () => {
	// 用 agentSubjectHash 风格的 subject + 非本机 nodeHash 构造一个“远端 agent 实体”
	const remoteNodeHash = '7'.repeat(64)
	const remoteAgentOwner = agentEntityHash(remoteNodeHash, 'chars/remote-agent')
	const someSeed = randomSeed()
	const event = await makeRemoteSignedEvent(someSeed, remoteAgentOwner, {
		type: 'post', content: { text: 'remote agent post', visibility: 'public' },
	})
	assertEquals(await sync.ingestRemoteTimelineEvent(username, remoteAgentOwner, event), false)
})
