/**
 * social OnMessage 分发：GetReply 回退、意愿裁决、去重、care 通知。
 */
/* global Deno */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { randomSeed, seedRemoteTimeline } from '../federation/remote_timeline.mjs'
import { createTestSession } from '../harness.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const GETREPLY_CHAR = 'mention_getreply_agent'
const PROBE_CHAR = 'social_on_message_probe'

const getSession = createTestSession()
const append = await import('../../src/timeline/append.mjs')
const dispatch = await import('../../src/dispatch.mjs')
const inbox = await import('../../src/inbox.mjs')
const following = await import('../../src/following.mjs')
const { agentEntityHash } = await import('fount/public/parts/shells/chat/src/chat/lib/entity.mjs')
const { getNodeHash } = await import('npm:@steve02081504/fount-p2p/node/identity')
const { getUserDictionary } = await import('fount/server/auth/index.mjs')
const { pubKeyHash, publicKeyFromSeed } = await import('npm:@steve02081504/fount-p2p/crypto')
const { encodeEntityHash } = await import('npm:@steve02081504/fount-p2p/core/entity_id')
const { setCared } = await import('fount/public/parts/shells/chat/src/chat/lib/care.mjs')
const { readJsonl } = await import('npm:@steve02081504/fount-p2p/dag/storage')

/**
 * @param {string} username replica
 * @param {string} charName fixture 目录名
 * @returns {Promise<string>} agent entityHash
 */
async function seedAgentChar(username, charName) {
	const to = join(getUserDictionary(username), 'chars', charName)
	await mkdir(to, { recursive: true })
	await cp(join(fixturesRoot, 'chars', charName), to, { recursive: true })
	return agentEntityHash(getNodeHash(), `chars/${charName}`)
}

Deno.test('dispatchSocialMessage falls back to chat.GetReply when OnMessage missing and mentioned', async () => {
	dispatch.resetSocialDispatchDedupForTests()
	const { username, operator } = await getSession()
	const agentHash = await seedAgentChar(username, GETREPLY_CHAR)
	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: `ping @[entity:${agentHash}]`, visibility: 'public' },
	}, { fanout: false })

	const agentTimeline = await append.readTimelineEvents(username, agentHash)
	const reply = agentTimeline.find(ev =>
		ev.type === 'post' && String(ev.content?.text || '').includes('mention-getreply-fallback'))
	assert(reply, 'agent should publish GetReply reply when mentioned without OnMessage')
	assertEquals(reply.content.replyTo?.entityHash, operator)
})

Deno.test('OnMessage returns false → no reply published', async () => {
	dispatch.resetSocialDispatchDedupForTests()
	globalThis.__fountSocialOnMessageProbe = { events: [], returnValue: false }
	const { username, operator } = await getSession()
	const agentHash = await seedAgentChar(username, PROBE_CHAR)
	const before = (await append.readTimelineEvents(username, agentHash)).length
	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: `hey @[entity:${agentHash}]`, visibility: 'public' },
	}, { fanout: false })
	const after = await append.readTimelineEvents(username, agentHash)
	assertEquals(after.length, before, 'OnMessage false must not publish reply')
	assert(globalThis.__fountSocialOnMessageProbe.events.length >= 1, 'OnMessage still invoked')
})

Deno.test('unmentioned post still invokes OnMessage with event shape', async () => {
	dispatch.resetSocialDispatchDedupForTests()
	globalThis.__fountSocialOnMessageProbe = { events: [], returnValue: false }
	const { username, operator } = await getSession()
	const agentHash = await seedAgentChar(username, PROBE_CHAR)
	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'plain post without mentions', visibility: 'public' },
	}, { fanout: false })
	const events = globalThis.__fountSocialOnMessageProbe.events
	assert(events.length >= 1, 'OnMessage invoked for unmentioned visible post')
	const hit = events.find(row => row.viewerEntityHash === agentHash)
	assert(hit, 'probe agent received event')
	assertEquals(hit.authorEntityHash, operator)
	assertEquals(hit.mentions?.entityHashes?.length ?? 0, 0)
	assert('postText' in hit && 'postId' in hit)
})

Deno.test('duplicate dispatchSocialMessage only invokes OnMessage once per agent', async () => {
	dispatch.resetSocialDispatchDedupForTests()
	globalThis.__fountSocialOnMessageProbe = { events: [], returnValue: false }
	const { username, operator } = await getSession()
	await seedAgentChar(username, PROBE_CHAR)
	const post = await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'dedup probe', visibility: 'public' },
	}, { fanout: false })
	const countAfterCommit = globalThis.__fountSocialOnMessageProbe.events.length
	assert(countAfterCommit >= 1)
	await dispatch.dispatchSocialMessage(username, operator, post)
	assertEquals(globalThis.__fountSocialOnMessageProbe.events.length, countAfterCommit)
})

Deno.test('operator care author → care_post inbox row on post ingest', async () => {
	dispatch.resetSocialDispatchDedupForTests()
	const { username, operator } = await getSession()
	const seed = randomSeed()
	const subject = pubKeyHash(publicKeyFromSeed(seed))
	const author = encodeEntityHash('4'.repeat(64), subject)
	await seedRemoteTimeline(username, seed, author, [
		{ type: 'social_meta', content: { hideFromDiscovery: false, createdAt: 1 } },
	])
	await following.setFollow(username, operator, author, true)
	await setCared(username, operator, author, true)
	await seedRemoteTimeline(username, seed, author, [
		{ type: 'post', content: { text: 'cared author post', visibility: 'public' } },
	])
	const rows = await readJsonl(inbox.inboxEventsPath(username, operator))
	const careRow = rows.find(row => row.type === 'care_post' && row.actorEntityHash === author)
	assert(careRow, 'care_post row written for cared author')
	assertEquals(careRow.postId?.length > 0, true)
})

Deno.test('processSocialPostNotifyRpc rejects invalid post payload', async () => {
	const { username } = await getSession()
	const result = await dispatch.processSocialPostNotifyRpc(username, { post: { type: 'like' } })
	assertEquals(result.ok, false)
})
