/**
 * acting 读侧平权：feed / notifications / follower 索引 / OnMessage 经 agent following。
 */
/* global Deno */
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
const feed = await import('../../src/feed.mjs')
const notifications = await import('../../src/notifications.mjs')
const following = await import('../../src/following.mjs')
const followerIndex = await import('../../src/federation/follower_index.mjs')
const dispatch = await import('../../src/dispatch.mjs')
const { agentEntityHash } = await import('fount/public/parts/shells/chat/src/chat/lib/entity.mjs')
const { getNodeHash } = await import('npm:@steve02081504/fount-p2p/node/identity')
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
	const hash = agentEntityHash(getNodeHash(), `chars/${charName}`)
	await ensureEntitySocialReady(username, hash)
	return hash
}

Deno.test('agent following feeds home feed; operator feed excludes agent-only follow', async () => {
	const { username, operator } = await getSession()
	const agentHash = await seedAgentChar(username, PROBE_CHAR)
	const authorHash = await seedAgentChar(username, AUTHOR_CHAR)
	await following.setFollow(username, agentHash, authorHash, true)

	const authorPost = await append.commitTimelineEvent(username, authorHash, {
		type: 'post',
		content: { text: 'agent feed parity post', visibility: 'public' },
	}, { fanout: false })

	const agentFeed = await feed.buildHomeFeed(username, { actingEntityHash: agentHash, limit: 50 })
	const operatorFeed = await feed.buildHomeFeed(username, { limit: 50 })

	assert(agentFeed.items.some(item =>
		item.entityHash === authorHash && item.postId === authorPost.id),
	'agent acting feed should include followed author post')
	assert(!operatorFeed.items.some(item =>
		item.entityHash === authorHash && item.postId === authorPost.id),
	'operator feed should not include post only followed by agent')
})

Deno.test('buildNotifications reads acting entity inbox', async () => {
	const { username, operator } = await getSession()
	const agentHash = await seedAgentChar(username, PROBE_CHAR)

	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: `mention agent @[entity:${agentHash}]`, visibility: 'public' },
	}, { fanout: false })

	const agentPage = await notifications.buildNotifications(username, {
		actingEntityHash: agentHash,
		limit: 50,
	})
	const operatorPage = await notifications.buildNotifications(username, { limit: 50 })

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
