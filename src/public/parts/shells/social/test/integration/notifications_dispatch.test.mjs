/**
 * 通知与 dispatch 主流程。
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

const getSession = createTestSession()

const append = await import('../../src/timeline/append.mjs')
const notifications = await import('../../src/notifications.mjs')
const dispatch = await import('../../src/dispatch.mjs')
const following = await import('../../src/following.mjs')
const { ensureLocalAgentEntityHash } = await import('fount/public/parts/shells/chat/src/chat/lib/entity.mjs')
const { getUserDictionary } = await import('fount/server/auth/index.mjs')
const { pubKeyHash, publicKeyFromSeed } = await import('npm:@steve02081504/fount-p2p/crypto')
const { encodeEntityHash } = await import('npm:@steve02081504/fount-p2p/core/entity_id')

/**
 * @param {string} username replica
 * @returns {Promise<string>} agent entityHash
 */
async function seedMentionAgentChar(username) {
	const to = join(getUserDictionary(username), 'chars', GETREPLY_CHAR)
	await mkdir(to, { recursive: true })
	await cp(join(fixturesRoot, 'chars', GETREPLY_CHAR), to, { recursive: true })
	return ensureLocalAgentEntityHash(username, GETREPLY_CHAR)
}

Deno.test('buildNotifications includes like repost follow reply mention', async () => {
	const { username, operator } = await getSession()
	const parent = await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'notify me', visibility: 'public' },
	}, { fanout: false })

	const seed = randomSeed()
	const subject = pubKeyHash(publicKeyFromSeed(seed))
	const remoteOwner = encodeEntityHash('4'.repeat(64), subject)
	await seedRemoteTimeline(username, seed, remoteOwner, [
		{ type: 'social_meta', content: { hideFromDiscovery: false, createdAt: 1 } },
		{ type: 'follow', content: { targetEntityHash: operator, rep_edge: 1 } },
		{ type: 'like', content: { targetEntityHash: operator, targetPostId: parent.id } },
		{ type: 'repost', content: { targetEntityHash: operator, targetPostId: parent.id, comment: 'nice' } },
		{ type: 'post', content: {
			text: `reply @${operator}`,
			visibility: 'public',
			replyTo: { entityHash: operator, postId: parent.id },
		} },
		{ type: 'post', content: {
			text: `hello @[entity:${operator}] there`,
			visibility: 'public',
		} },
	])

	await following.setFollow(username, operator, remoteOwner, true)

	const { notifications: rows, viewerEntityHash } = await notifications.buildNotifications(username, { limit: 50 })
	assertEquals(viewerEntityHash, operator)
	const types = new Set(rows.map(r => r.type))
	assert(types.has('like'))
	assert(types.has('repost'))
	assert(types.has('follow'))
	assert(types.has('reply'))
	assert(types.has('mention'))
	assert(rows.every(row => 'actorEntityHash' in row && row.postId !== undefined && row.targetPostId !== undefined))
})

Deno.test('buildNotifications respects actingEntityHash viewer', async () => {
	const { username, operator } = await getSession()
	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'acting notify target', visibility: 'public' },
	}, { fanout: false })

	const agentHash = await seedMentionAgentChar(username)
	const { ensureEntitySocialReady } = await import('../../src/lib/bootstrap.mjs')
	await ensureEntitySocialReady(username, agentHash)
	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: {
			text: `agent only @[entity:${agentHash}]`,
			visibility: 'public',
		},
	}, { fanout: false })

	const operatorPage = await notifications.buildNotifications(username, { limit: 50 })
	assertEquals(operatorPage.viewerEntityHash, operator)

	const agentPage = await notifications.buildNotifications(username, {
		actingEntityHash: agentHash,
		limit: 50,
	})
	assertEquals(agentPage.viewerEntityHash, agentHash)
	assert(agentPage.notifications.some(row => row.type === 'mention'))
	const agentMentionPostId = agentPage.notifications.find(row => row.type === 'mention')?.postId
	assert(agentMentionPostId)
	assert(!operatorPage.notifications.some(row => row.postId === agentMentionPostId),
		'operator inbox should not include agent-only mention')
})

Deno.test('dispatchSocialMessage does not publish agent reply without mention when no OnMessage', async () => {
	dispatch.resetSocialDispatchDedupForTests()
	const { username, operator } = await getSession()
	const agentHash = await seedMentionAgentChar(username)
	const beforeCount = (await append.readTimelineEvents(username, agentHash)).length
	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'no mentions here', visibility: 'public' },
	}, { fanout: false })
	const after = await append.readTimelineEvents(username, agentHash)
	assertEquals(after.length, beforeCount, 'agent without OnMessage must not reply when unmentioned')
})

Deno.test('processSocialPostNotifyRpc accepts signed post payload', async () => {
	dispatch.resetSocialDispatchDedupForTests()
	const { username, operator } = await getSession()
	const post = await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'rpc notify', visibility: 'public' },
	}, { fanout: false })
	const result = await dispatch.processSocialPostNotifyRpc(username, {
		authorEntityHash: operator,
		posterUsername: username,
		post,
	})
	assertEquals(result.ok, true)

	const forged = await dispatch.processSocialPostNotifyRpc(username, {
		authorEntityHash: operator,
		posterUsername: username,
		post: { ...post, signature: '00'.repeat(64), id: 'f'.repeat(64) },
	})
	assertEquals(forged.ok, false)
})
