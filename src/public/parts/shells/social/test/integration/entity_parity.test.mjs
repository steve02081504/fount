/**
 * 实体平权：agent 经 SocialClient 的 feed / notifications 与 operator HTTP 读模型隔离；follower 索引 / OnMessage。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { socialOnMessageProbe } from '../fixtures/probes/socialOnMessageProbe.mjs'
import { createTestSession, seedAgentChar } from '../harness.mjs'

const PROBE_CHAR = 'social_on_message_probe'
const AUTHOR_CHAR = 'mention_getreply_agent'

const getSession = createTestSession()
const append = await import('../../src/timeline/append.mjs')
const following = await import('../../src/following.mjs')
const followerIndex = await import('../../src/federation/follower/index.mjs')
const dispatch = await import('../../src/dispatch.mjs')

/**
 * @param {string} username replica
 * @param {string} charName fixture 目录名
 * @returns {Promise<string>} agent entityHash
 */
const seedReadyAgent = (username, charName) => seedAgentChar(username, charName, { ensureSocialReady: true })

Deno.test('agent following feeds home feed; operator feed excludes agent-only follow', async () => {
	const { username } = await getSession()
	const agentHash = await seedReadyAgent(username, PROBE_CHAR)
	const authorHash = await seedReadyAgent(username, AUTHOR_CHAR)
	await following.setFollow(username, agentHash, authorHash, true)

	const authorPost = await append.commitTimelineEvent(username, authorHash, {
		type: 'post',
		content: { text: 'agent feed parity post', visibility: 'public' },
	}, { fanout: false })

	const { getSocialClient } = await import('../../src/api/client/index.mjs')
	const agentClient = await getSocialClient(username, agentHash)
	const operatorClient = await getSocialClient(username)
	const agentFeed = await agentClient.feed({ limit: 50 })
	const operatorFeed = await operatorClient.feed({ limit: 50 })

	assert(agentFeed.items.some(item =>
		item.entityHash === authorHash && item.postId === authorPost.id),
	'agent feed should include followed author post')
	assert(!operatorFeed.items.some(item =>
		item.entityHash === authorHash && item.postId === authorPost.id),
	'operator feed should not include post only followed by agent')
})

Deno.test('buildNotifications reads agent entity inbox via SocialClient', async () => {
	const { username, operator } = await getSession()
	const agentHash = await seedReadyAgent(username, PROBE_CHAR)

	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: `mention agent @[entity:${agentHash}]`, visibility: 'public' },
	}, { fanout: false })

	const { getSocialClient } = await import('../../src/api/client/index.mjs')
	const agentPage = await (await getSocialClient(username, agentHash)).notifications({ limit: 50 })
	const operatorPage = await (await getSocialClient(username)).notifications({ limit: 50 })

	assertEquals(agentPage.viewerEntityHash, agentHash)
	assert(agentPage.notifications.some(row => row.type === 'mention'), 'agent inbox has mention')
	assertEquals(operatorPage.viewerEntityHash, operator)
	assert(!operatorPage.notifications.some(row =>
		row.type === 'mention' && row.postId && agentPage.notifications.some(a => a.postId === row.postId)),
	'operator inbox should not include agent-only mention')
})

Deno.test('agent follow projects entity-granular follower index', async () => {
	const { username, operator } = await getSession()
	const agentHash = await seedReadyAgent(username, PROBE_CHAR)
	await following.setFollow(username, agentHash, operator, true)

	const followers = await followerIndex.listLocalFollowersOf(operator)
	assert(followers.some(row =>
		row.replicaUsername === username && row.entityHash === agentHash),
	'follower index records agent entity not just replica username')

	const known = await followerIndex.listKnownFollowersOf(operator)
	assert(known.some(row => row.entityHash === agentHash), 'known followers include agent')

	const { getSocialClient } = await import('../../src/api/client/index.mjs')
	const client = await getSocialClient(username)
	const profile = await client.profile(operator)
	assert(profile.followerCount >= 1, 'profile reports followerCount')
	const list = await client.profileFollowers(operator)
	assert(list.followers.some(row => row.entityHash === agentHash), 'followers API lists agent')
})

Deno.test('operator SocialClient may delete owned agent post', async () => {
	const { username } = await getSession()
	const agentHash = await seedReadyAgent(username, PROBE_CHAR)
	const { getSocialClient } = await import('../../src/api/client/index.mjs')
	const agentClient = await getSocialClient(username, agentHash)
	const post = await agentClient.post({ text: 'agent post owner may delete', visibility: 'public' })
	const operatorClient = await getSocialClient(username)
	const deleted = await (await operatorClient.post(agentHash, post.postId)).delete()
	assertEquals(deleted.type, 'post_delete')
	assertEquals(deleted.content.targetPostId, post.postId)
	const view = await append.readTimelineEvents(username, agentHash)
	assert(view.some(row => row.type === 'post_delete' && row.content?.targetPostId === post.postId))
	const { getOperatorSecretKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
	const { pubKeyHash, publicKeyFromSeed } = await import('npm:@steve02081504/fount-p2p/crypto')
	const ownerSender = pubKeyHash(publicKeyFromSeed(
		new Uint8Array(Buffer.from(await getOperatorSecretKey(username), 'hex')),
	))
	const deleteRow = view.find(row => row.type === 'post_delete' && row.content?.targetPostId === post.postId)
	assertEquals(deleteRow.sender, ownerSender)
})

Deno.test('operator SocialClient may edit owned agent post', async () => {
	const { username } = await getSession()
	const agentHash = await seedReadyAgent(username, PROBE_CHAR)
	const { getSocialClient } = await import('../../src/api/client/index.mjs')
	const agentClient = await getSocialClient(username, agentHash)
	const post = await agentClient.post({ text: 'agent post owner may edit', visibility: 'public' })
	const operatorClient = await getSocialClient(username)
	const edited = await (await operatorClient.post(agentHash, post.postId)).edit({ text: 'edited by owner' })
	assertEquals(edited.type, 'post_edit')
	assertEquals(edited.content.targetPostId, post.postId)
	assertEquals(edited.content.text, 'edited by owner')
	const view = await append.readTimelineEvents(username, agentHash)
	assert(view.some(row => row.type === 'post_edit' && row.content?.targetPostId === post.postId))
})

Deno.test('setEntityOwner lets declared master manage human posts; operator lookup survives', async () => {
	const { username, operator } = await getSession()
	const masterHash = await seedReadyAgent(username, AUTHOR_CHAR)
	const {
		setEntityOwner,
		resolveOperatorEntityHashForUser,
		loadEntityIdentity,
	} = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
	await setEntityOwner(username, operator, masterHash)
	assertEquals(await resolveOperatorEntityHashForUser(username), operator)
	assertEquals((await loadEntityIdentity(username, operator)).ownerEntityHash, masterHash)

	const { getSocialClient } = await import('../../src/api/client/index.mjs')
	const humanClient = await getSocialClient(username)
	const post = await humanClient.post({ text: 'human post owned by agent', visibility: 'public' })
	const masterClient = await getSocialClient(username, masterHash)
	const edited = await (await masterClient.post(operator, post.postId)).edit({ text: 'master edit' })
	assertEquals(edited.type, 'post_edit')
	const deleted = await (await masterClient.post(operator, post.postId)).delete()
	assertEquals(deleted.type, 'post_delete')

	await setEntityOwner(username, operator, null)
	assertEquals(await resolveOperatorEntityHashForUser(username), operator)
	assertEquals((await loadEntityIdentity(username, operator)).ownerEntityHash, null)
})

Deno.test('followed author post triggers agent OnMessage via timeline dispatch', async () => {
	dispatch.resetSocialDispatchDedupForTests()
	socialOnMessageProbe.reset()
	socialOnMessageProbe.returnValue = false
	const { username } = await getSession()
	const agentHash = await seedReadyAgent(username, PROBE_CHAR)
	const authorHash = await seedReadyAgent(username, AUTHOR_CHAR)
	await following.setFollow(username, agentHash, authorHash, true)

	await append.commitTimelineEvent(username, authorHash, {
		type: 'post',
		content: { text: 'followed author new post', visibility: 'public' },
	}, { fanout: false })

	const hit = socialOnMessageProbe.events.find(row => row.viewerEntityHash === agentHash)
	assert(hit, 'agent OnMessage invoked for followed author post')
	assertEquals(hit.authorEntityHash, authorHash)
})

Deno.test('rebuildFollowerIndex restores agent follows', async () => {
	const { username, operator } = await getSession()
	const agentHash = await seedReadyAgent(username, PROBE_CHAR)
	await following.setFollow(username, agentHash, operator, true)

	await followerIndex.rebuildFollowerIndex()
	const followers = await followerIndex.listLocalFollowersOf(operator)
	assert(followers.some(row =>
		row.replicaUsername === username && row.entityHash === agentHash))
})

Deno.test('agent saved posts CRUD+search isolated from operator', async () => {
	const { username, operator } = await getSession()
	const agentHash = await seedReadyAgent(username, PROBE_CHAR)
	const { getSocialClient } = await import('../../src/api/client/index.mjs')
	const agentClient = await getSocialClient(username, agentHash)
	const operatorClient = await getSocialClient(username)

	const post = await agentClient.post({ text: 'agent-saved-only-post', visibility: 'public' })
	await agentClient.saved.add({ entityHash: post.entityHash, postId: post.postId })
	const agentHit = await agentClient.saved.search('agent-saved-only')
	assert(agentHit.posts.some(row => row.postId === post.postId), 'agent can search own saved posts')

	const operatorList = await operatorClient.saved.list()
	assert(!operatorList.unfiled.some(row => row.postId === post.postId), 'operator unfiled excludes agent saves')
	for (const folder of Object.values(operatorList.folders))
		assert(!folder.posts.some(row => row.postId === post.postId), 'operator folders exclude agent saves')
	const operatorHit = await operatorClient.saved.search('agent-saved-only')
	assertEquals(operatorHit.posts.length, 0)

	await operatorClient.saved.add({ entityHash: operator, postId: post.postId })
	assert((await operatorClient.saved.list()).unfiled.some(row => row.postId === post.postId))
	assertEquals((await agentClient.saved.search('agent-saved-only')).posts.length, 1)
})

Deno.test('agent drafts isolated from operator', async () => {
	const { username } = await getSession()
	const agentHash = await seedReadyAgent(username, PROBE_CHAR)
	const { getSocialClient } = await import('../../src/api/client/index.mjs')
	const agentClient = await getSocialClient(username, agentHash)
	const operatorClient = await getSocialClient(username)

	const agentDraft = await agentClient.drafts.upsert({ text: 'agent-only-draft', visibility: 'public' })
	assert((await agentClient.drafts.list()).drafts.some(row => row.draftId === agentDraft.draftId))
	assert(!(await operatorClient.drafts.list()).drafts.some(row => row.draftId === agentDraft.draftId))

	const operatorDraft = await operatorClient.drafts.upsert({ text: 'operator-only-draft', visibility: 'public' })
	assert((await operatorClient.drafts.list()).drafts.some(row => row.draftId === operatorDraft.draftId))
	assert(!(await agentClient.drafts.list()).drafts.some(row => row.draftId === operatorDraft.draftId))
})
