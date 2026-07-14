/**
 * 实体平权：agent 经 SocialClient 的 feed / notifications 与 operator HTTP 读模型隔离；follower 索引 / OnMessage。
 */
/* global Deno */
import { Buffer } from 'node:buffer'
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createTestSession } from '../harness.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const PROBE_CHAR = 'social_on_message_probe'
const AUTHOR_CHAR = 'mention_getreply_agent'

const getSession = createTestSession()
const append = await import('../../src/timeline/append.mjs')
const following = await import('../../src/following.mjs')
const followerIndex = await import('../../src/federation/follower_index.mjs')
const dispatch = await import('../../src/dispatch.mjs')
const { ensureLocalAgentEntityHash } = await import('fount/public/parts/shells/chat/src/entity/member.mjs')
const { getUserDictionary } = await import('fount/server/auth/index.mjs')
const { ensureEntitySocialReady } = await import('../../src/lib/bootstrap.mjs')

/**
 * @param {string} username replica
 * @param {string} charName fixture 目录名
 * @returns {Promise<string>} agent entityHash
 */
async function seedAgentChar(username, charName) {
	const to = join(getUserDictionary(username), 'chars', charName)
	await mkdir(to, { recursive: true })
	await cp(join(fixturesRoot, 'chars', charName), to, { recursive: true })
	const hash = await ensureLocalAgentEntityHash(username, charName)
	await ensureEntitySocialReady(username, hash)
	return hash
}

Deno.test('agent following feeds home feed; operator feed excludes agent-only follow', async () => {
	const { username } = await getSession()
	const agentHash = await seedAgentChar(username, PROBE_CHAR)
	const authorHash = await seedAgentChar(username, AUTHOR_CHAR)
	await following.setFollow(username, agentHash, authorHash, true)

	const authorPost = await append.commitTimelineEvent(username, authorHash, {
		type: 'post',
		content: { text: 'agent feed parity post', visibility: 'public' },
	}, { fanout: false })

	const { getSocialClient } = await import('../../src/api/client.mjs')
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
	const agentHash = await seedAgentChar(username, PROBE_CHAR)

	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: `mention agent @[entity:${agentHash}]`, visibility: 'public' },
	}, { fanout: false })

	const { getSocialClient } = await import('../../src/api/client.mjs')
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
	const agentHash = await seedAgentChar(username, PROBE_CHAR)
	await following.setFollow(username, agentHash, operator, true)

	const followers = await followerIndex.listLocalFollowersOf(operator)
	assert(followers.some(row =>
		row.replicaUsername === username && row.entityHash === agentHash),
	'follower index records agent entity not just replica username')
})

Deno.test('operator SocialClient may delete owned agent post', async () => {
	const { username } = await getSession()
	const agentHash = await seedAgentChar(username, PROBE_CHAR)
	const { getSocialClient } = await import('../../src/api/client.mjs')
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

Deno.test('followed author post triggers agent OnMessage via timeline dispatch', async () => {
	dispatch.resetSocialDispatchDedupForTests()
	globalThis.__fountSocialOnMessageProbe = { events: [], returnValue: false }
	const { username } = await getSession()
	const agentHash = await seedAgentChar(username, PROBE_CHAR)
	const authorHash = await seedAgentChar(username, AUTHOR_CHAR)
	await following.setFollow(username, agentHash, authorHash, true)

	await append.commitTimelineEvent(username, authorHash, {
		type: 'post',
		content: { text: 'followed author new post', visibility: 'public' },
	}, { fanout: false })

	const hit = globalThis.__fountSocialOnMessageProbe.events.find(row => row.viewerEntityHash === agentHash)
	assert(hit, 'agent OnMessage invoked for followed author post')
	assertEquals(hit.authorEntityHash, authorHash)
})

Deno.test('rebuildFollowerIndex restores agent follows', async () => {
	const { username, operator } = await getSession()
	const agentHash = await seedAgentChar(username, PROBE_CHAR)
	await following.setFollow(username, agentHash, operator, true)

	await followerIndex.rebuildFollowerIndex()
	const followers = await followerIndex.listLocalFollowersOf(operator)
	assert(followers.some(row =>
		row.replicaUsername === username && row.entityHash === agentHash))
})
