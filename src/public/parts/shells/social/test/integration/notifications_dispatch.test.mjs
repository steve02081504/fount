/**
 * 通知与 dispatch 主流程。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { randomSeed, seedRemoteTimeline } from '../federation/remote_timeline.mjs'
import { createTestSession, seedAgentChar } from '../harness.mjs'

const GETREPLY_CHAR = 'mention_getreply_agent'

const getSession = createTestSession()

const append = await import('../../src/timeline/append.mjs')
const notifications = await import('../../src/notifications.mjs')
const inbox = await import('../../src/inbox.mjs')
const dispatch = await import('../../src/dispatch.mjs')
const following = await import('../../src/following.mjs')
const { pubKeyHash, publicKeyFromSeed } = await import('npm:@steve02081504/fount-p2p/crypto')
const { encodeEntityHash } = await import('npm:@steve02081504/fount-p2p/core/entity_id')

/**
 * 为远程实体写入本地 profile.json（模拟其已设置的头像/显示名）。
 * @param {string} entityHash 远程实体 hash
 * @param {string} name 显示名
 * @param {string} avatar 头像 URL
 * @returns {Promise<void>}
 */
async function seedRemoteProfile(entityHash, name, avatar) {
	const { parseEntityHash } = await import('npm:@steve02081504/fount-p2p/core/entity_id')
	const { getEntityStore } = await import('npm:@steve02081504/fount-p2p/node/instance')
	const parsed = parseEntityHash(entityHash)
	await getEntityStore().writeEntityJson(entityHash, 'profile.json', {
		entityHash,
		nodeHash: parsed.nodeHash,
		subjectHash: parsed.subjectHash,
		localized: { 'zh-CN': { name, avatar } },
		status: 'offline',
		customStatus: '',
		lastSeenAt: 0,
		stats: { joinedAt: Date.now(), messageCount: 0, groupCount: 0, channelCount: 0 },
	})
}

/**
 * 生成一个跟随 operator 的远程关注者。
 * @param {string} operator 收件人 entityHash
 * @returns {Promise<string>} 关注者 entityHash
 */
async function seedFollowerTimeline(operator) {
	const seed = randomSeed()
	const subject = pubKeyHash(publicKeyFromSeed(seed))
	const follower = encodeEntityHash('4'.repeat(64), subject)
	const { username } = await getSession()
	await seedRemoteTimeline(username, seed, follower, [
		{ type: 'social_meta', content: { hideFromDiscovery: false, createdAt: 1 } },
		{ type: 'follow', content: { targetEntityHash: operator, rep_edge: 1 } },
	])
	return follower
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
		{
			type: 'post', content: {
				text: `reply @${operator}`,
				visibility: 'public',
				replyTo: { entityHash: operator, postId: parent.id },
			}
		},
		{
			type: 'post', content: {
				text: `hello @[entity:${operator}] there`,
				visibility: 'public',
			}
		},
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

Deno.test('buildNotifications respects viewerEntityHash / SocialClient agent', async () => {
	const { username, operator } = await getSession()
	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'viewer notify target', visibility: 'public' },
	}, { fanout: false })

	const agentHash = await seedAgentChar(username, GETREPLY_CHAR)
	const { ensureEntitySocialReady } = await import('../../src/lib/bootstrap.mjs')
	await ensureEntitySocialReady(username, agentHash)
	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: {
			text: `agent only @[entity:${agentHash}]`,
			visibility: 'public',
		},
	}, { fanout: false })

	const { getSocialClient } = await import('../../src/api/client/index.mjs')
	const operatorPage = await (await getSocialClient(username)).notifications({ limit: 50 })
	assertEquals(operatorPage.viewerEntityHash, operator)

	const agentPage = await (await getSocialClient(username, agentHash)).notifications({ limit: 50 })
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
	const agentHash = await seedAgentChar(username, GETREPLY_CHAR)
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

Deno.test('buildNotifications enriches actor authorProfile (name/avatar)', async () => {
	const { username, operator } = await getSession()
	const follower = await seedFollowerTimeline(operator)
	await seedRemoteProfile(follower, '我的朋友', 'https://example.com/friend-avatar.png')
	await following.setFollow(username, operator, follower, true)
	const { notifications: rows } = await notifications.buildNotifications(username, { limit: 50 })
	const followRow = rows.find(row => row.type === 'follow' && row.actorEntityHash === follower)
	assert(followRow, 'follow notification present')
	assertEquals(followRow.actorEntityHash, follower)
	assertEquals(followRow.authorProfile?.name, '我的朋友')
	assertEquals(followRow.authorProfile?.avatar, 'https://example.com/friend-avatar.png')
})

Deno.test('appendInboxFromTimelineEvent stores authorProfile in inbox row', async () => {
	const { username, operator } = await getSession()
	const seed = randomSeed()
	const subject = pubKeyHash(publicKeyFromSeed(seed))
	const follower = encodeEntityHash('4'.repeat(64), subject)
	await seedRemoteProfile(follower, '关注我的好友', 'https://example.com/friend2-avatar.png')
	await seedRemoteTimeline(username, seed, follower, [
		{ type: 'social_meta', content: { hideFromDiscovery: false, createdAt: 1 } },
		{ type: 'follow', content: { targetEntityHash: operator, rep_edge: 1 } },
	])
	await following.setFollow(username, operator, follower, true)
	const { readJsonl } = await import('npm:@steve02081504/fount-p2p/dag/storage')
	const rows = await readJsonl(inbox.inboxEventsPath(username, operator)).catch(() => [])
	const followRow = rows.find(row => row.type === 'follow' && row.actorEntityHash === follower)
	assert(followRow, 'inbox follow row present')
	assertEquals(followRow.authorProfile?.name, '关注我的好友')
	assertEquals(followRow.authorProfile?.avatar, 'https://example.com/friend2-avatar.png')
})

Deno.test('notification push copy: title is actor name, body is action phrase', () => {
	const push = inbox.buildNotificationPushCopy(
		{ type: 'follow', actorEntityHash: 'a'.repeat(128), snippet: null },
		{ name: '我的好友' },
	)
	assertEquals(push.title, '我的好友')
	assertEquals(push.body, '关注了你')
})

Deno.test('notification push copy: content types append snippet', () => {
	const likePush = inbox.buildNotificationPushCopy(
		{ type: 'like', actorEntityHash: 'a'.repeat(128), snippet: '好帖' },
		{ name: '小明' },
	)
	assertEquals(likePush.title, '小明')
	assertEquals(likePush.body, '赞了你的帖子：好帖')
	const replyPush = inbox.buildNotificationPushCopy(
		{ type: 'reply', actorEntityHash: 'a'.repeat(128), snippet: '原来如此' },
		{ name: '小红' },
	)
	assertEquals(replyPush.title, '小红')
	assertEquals(replyPush.body, '回复了你的帖子：原来如此')
})

Deno.test('notification push copy: falls back to short hash label without profile', async () => {
	const seed = randomSeed()
	const follower = encodeEntityHash('7'.repeat(64), pubKeyHash(publicKeyFromSeed(seed)))
	const { entityHashLabel } = await import('fount/public/parts/shells/chat/public/shared/entityHash.mjs')
	assertEquals(inbox.actorDisplayName(null, follower), entityHashLabel(follower))
	const push = inbox.buildNotificationPushCopy(
		{ type: 'follow', actorEntityHash: follower, snippet: null },
		null,
	)
	assertEquals(push.title, entityHashLabel(follower))
	assertEquals(push.body, '关注了你')
})
