/**
 * social OnMessage 分发：GetReply 回退、意愿裁决、去重、care 通知。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { randomSeed, seedRemoteTimeline } from '../federation/remote_timeline.mjs'
import { getReplyIdentityProbe } from '../fixtures/probes/getReplyIdentityProbe.mjs'
import { socialOnMessageProbe } from '../fixtures/probes/socialOnMessageProbe.mjs'
import { createTestSession, seedAgentChar } from '../harness.mjs'

const GETREPLY_CHAR = 'mention_getreply_agent'
const PROBE_CHAR = 'social_on_message_probe'

const getSession = createTestSession()
const append = await import('../../src/timeline/append.mjs')
const dispatch = await import('../../src/dispatch.mjs')
const inbox = await import('../../src/inbox.mjs')
const following = await import('../../src/following.mjs')
const { pubKeyHash, publicKeyFromSeed } = await import('npm:@steve02081504/fount-p2p/crypto')
const { encodeEntityHash } = await import('npm:@steve02081504/fount-p2p/core/entity_id')
const { setCared } = await import('fount/public/parts/shells/chat/src/chat/lib/care.mjs')
const { readJsonl } = await import('npm:@steve02081504/fount-p2p/dag/storage')

Deno.test('dispatchSocialMessage falls back to chat.GetReply when OnMessage missing and mentioned', async () => {
	dispatch.resetSocialDispatchDedupForTests()
	getReplyIdentityProbe.reset()
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

	const identity = getReplyIdentityProbe.last
	assert(identity, 'GetReply should capture identity fields')
	assertEquals(identity.UserUid, operator)
	assertEquals(identity.CharUid, agentHash)
	assertEquals(identity.ReplyToUid, operator)
	assertEquals(identity.chatLogUids?.[0], operator)
})

Deno.test('GetReply identity: stranger author must not become User*', async () => {
	dispatch.resetSocialDispatchDedupForTests()
	getReplyIdentityProbe.reset()
	const { username, operator } = await getSession()
	const agentHash = await seedAgentChar(username, GETREPLY_CHAR)
	const seed = randomSeed()
	const subject = pubKeyHash(publicKeyFromSeed(seed))
	const stranger = encodeEntityHash('5'.repeat(64), subject)
	await seedRemoteTimeline(username, seed, stranger, [
		{ type: 'social_meta', content: { hideFromDiscovery: false, createdAt: 1 } },
		{ type: 'post', content: { text: `hey @[entity:${agentHash}]`, visibility: 'public' } },
	])

	const identity = getReplyIdentityProbe.last
	assert(identity, 'GetReply should run for stranger @mention')
	assertEquals(identity.UserUid, operator, 'UserUid must stay local operator')
	assertEquals(identity.CharUid, agentHash)
	assertEquals(identity.ReplyToUid, stranger, 'ReplyToUid is the post author')
	assertEquals(identity.chatLogUids?.[0], stranger)
	assert(identity.UserUid !== stranger, 'never treat stranger as User*')
})

Deno.test('OnMessage returns false → no reply published', async () => {
	dispatch.resetSocialDispatchDedupForTests()
	socialOnMessageProbe.reset()
	socialOnMessageProbe.returnValue = false
	const { username, operator } = await getSession()
	const agentHash = await seedAgentChar(username, PROBE_CHAR)
	const before = (await append.readTimelineEvents(username, agentHash)).length
	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: `hey @[entity:${agentHash}]`, visibility: 'public' },
	}, { fanout: false })
	const after = await append.readTimelineEvents(username, agentHash)
	assertEquals(after.length, before, 'OnMessage false must not publish reply')
	assert(socialOnMessageProbe.events.length >= 1, 'OnMessage still invoked')
})

Deno.test('unmentioned post still invokes OnMessage with event shape', async () => {
	dispatch.resetSocialDispatchDedupForTests()
	socialOnMessageProbe.reset()
	socialOnMessageProbe.returnValue = false
	const { username, operator } = await getSession()
	const agentHash = await seedAgentChar(username, PROBE_CHAR)
	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'plain post without mentions', visibility: 'public' },
	}, { fanout: false })
	const events = socialOnMessageProbe.events
	assert(events.length >= 1, 'OnMessage invoked for unmentioned visible post')
	const hit = events.find(row => row.viewerEntityHash === agentHash)
	assert(hit, 'probe agent received event')
	assertEquals(hit.authorEntityHash, operator)
	assertEquals(hit.mentions?.entityHashes?.length ?? 0, 0)
	assert('postText' in hit && 'postId' in hit)
})

Deno.test('duplicate dispatchSocialMessage only invokes OnMessage once per agent', async () => {
	dispatch.resetSocialDispatchDedupForTests()
	socialOnMessageProbe.reset()
	socialOnMessageProbe.returnValue = false
	const { username, operator } = await getSession()
	await seedAgentChar(username, PROBE_CHAR)
	const post = await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'dedup probe', visibility: 'public' },
	}, { fanout: false })
	const countAfterCommit = socialOnMessageProbe.events.length
	assert(countAfterCommit >= 1)
	await dispatch.dispatchSocialMessage(username, operator, post)
	assertEquals(socialOnMessageProbe.events.length, countAfterCommit)
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
