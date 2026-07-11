/**
 * M5：inbox 持久化 + 已读水位 + buildNotifications unreadCount + 聚合读模型。
 */
/* global Deno */
import fs from 'node:fs'
import { writeFile } from 'node:fs/promises'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { randomSeed, seedRemoteTimeline } from '../federation/remote_timeline.mjs'
import { createTestSession } from '../harness.mjs'

const getSession = createTestSession()

const append = await import('../../src/timeline/append.mjs')
const notifications = await import('../../src/notifications.mjs')
const inbox = await import('../../src/inbox.mjs')
const following = await import('../../src/following.mjs')
const { pubKeyHash, publicKeyFromSeed } = await import('fount/scripts/p2p/crypto.mjs')
const { encodeEntityHash } = await import('fount/scripts/p2p/entity_id.mjs')
const { appendJsonlSynced } = await import('fount/scripts/p2p/dag/storage.mjs')

Deno.test('inbox written on ingest and seen watermark clears unreadCount', async () => {
	const { username, operator } = await getSession()
	const parent = await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'inbox target', visibility: 'public' },
	}, { fanout: false })

	const seed = randomSeed()
	const subject = pubKeyHash(publicKeyFromSeed(seed))
	const remoteOwner = encodeEntityHash('4'.repeat(64), subject)
	await seedRemoteTimeline(username, seed, remoteOwner, [
		{ type: 'social_meta', content: { hideFromDiscovery: false, createdAt: 1 } },
		{ type: 'like', content: { targetEntityHash: operator, targetPostId: parent.id } },
	])

	await following.setFollow(username, operator, remoteOwner, true)

	const before = await notifications.buildNotifications(username, { limit: 20 })
	assert(before.notifications.some(row => row.type === 'like'), 'like in inbox')
	assert((before.unreadCount ?? 0) >= 1, 'has unread')

	const at = before.notifications[0]?.at || Date.now()
	inbox.setNotificationsSeenAt(username, operator, at)

	const after = await notifications.buildNotifications(username, { limit: 20 })
	assertEquals(after.unreadCount, 0)
})

Deno.test('local commit writes inbox for remote reply recipient', async () => {
	const { username, operator } = await getSession()
	const target = await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'parent', visibility: 'public' },
	}, { fanout: false })

	const seed = randomSeed()
	const subject = pubKeyHash(publicKeyFromSeed(seed))
	const remoteOwner = encodeEntityHash('4'.repeat(64), subject)
	await seedRemoteTimeline(username, seed, remoteOwner, [
		{ type: 'social_meta', content: { hideFromDiscovery: false, createdAt: 1 } },
		{
			type: 'post',
			content: {
				text: 'remote reply body',
				visibility: 'public',
				replyTo: { entityHash: operator, postId: target.id },
			},
		},
	])
	await following.setFollow(username, operator, remoteOwner, true)

	const { notifications: rows } = await notifications.buildNotifications(username, { limit: 10 })
	assert(rows.some(row => row.type === 'reply' && row.targetPostId === target.id))
})

Deno.test('self reply does not write inbox notification', async () => {
	const { username, operator } = await getSession()
	const target = await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'parent', visibility: 'public' },
	}, { fanout: false })

	await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: {
			text: 'self reply',
			visibility: 'public',
			replyTo: { entityHash: operator, postId: target.id },
		},
	}, { fanout: false })

	const { notifications: rows } = await notifications.buildNotifications(username, { limit: 10 })
	assert(!rows.some(row => row.type === 'reply' && row.targetPostId === target.id))
})

Deno.test('aggregateNotificationRows merges 1000 likes on one target', () => {
	const viewer = 'a'.repeat(128)
	const rows = Array.from({ length: 1000 }, (_, index) => ({
		type: 'like',
		actorEntityHash: `b${String(index).padStart(127, '0')}`,
		postId: null,
		targetPostId: 'post-1',
		targetEntityHash: viewer,
		at: index,
	}))
	const aggregated = inbox.aggregateNotificationRows(rows, viewer)
	assertEquals(aggregated.length, 1)
	assertEquals(aggregated[0].actorCount, 1000)
})

Deno.test('inbox read aggregates seeded likes into one card', async () => {
	const { username, operator } = await getSession()
	const parent = await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'aggregate target', visibility: 'public' },
	}, { fanout: false })

	fs.rmSync(inbox.inboxDir(username, operator), { recursive: true, force: true })
	const eventsPath = inbox.inboxEventsPath(username, operator)
	fs.mkdirSync(inbox.inboxDir(username, operator), { recursive: true })
	const lines = []
	for (let index = 0; index < 12; index++) 
		lines.push(JSON.stringify({
			type: 'like',
			actorEntityHash: `c${String(index).padStart(127, '0')}`,
			postId: null,
			targetPostId: parent.id,
			targetEntityHash: operator,
			snippet: 'aggregate target',
			at: index,
		}))
	
	await writeFile(eventsPath, `${lines.join('\n')}\n`, 'utf8')

	const page = await inbox.readInboxNotifications(username, operator, { limit: 10 })
	assertEquals(page.notifications.length, 1)
	assertEquals(page.notifications[0].actorCount, 12)
	assertEquals(page.unreadCount, 1)
})

Deno.test('types filter limits aggregated inbox page', async () => {
	const { username, operator } = await getSession()
	const eventsPath = inbox.inboxEventsPath(username, operator)
	const actorA = encodeEntityHash('4'.repeat(64), pubKeyHash(publicKeyFromSeed(randomSeed())))
	const actorB = encodeEntityHash('4'.repeat(64), pubKeyHash(publicKeyFromSeed(randomSeed())))
	await appendJsonlSynced(eventsPath, {
		type: 'mention',
		actorEntityHash: actorA,
		postId: 'post-mention',
		targetPostId: null,
		at: Date.now(),
	})
	await appendJsonlSynced(eventsPath, {
		type: 'like',
		actorEntityHash: actorB,
		postId: null,
		targetPostId: 'post-like',
		targetEntityHash: operator,
		at: Date.now() - 1,
	})

	const mentions = await inbox.readInboxNotifications(username, operator, { limit: 10, types: ['mention'] })
	assertEquals(mentions.notifications.length, 1)
	assertEquals(mentions.notifications[0].type, 'mention')
})

Deno.test('appendInboxFromTimelineEvent pushes notification over feed WS', async () => {
	const feedHub = await import('../../src/ws/feedHub.mjs')
	const { username, operator } = await getSession()
	/** 已发送的 WebSocket 载荷记录。
	 * @type {string[]} */
	const sent = []
	/** 事件名到回调集合的注册表。
	 * @type {Map<string, Set<() => void>>} */
	const handlers = new Map()
	const mockSocket = {
		readyState: 1,
		/** 记录推送载荷。
		 * @param {string} text JSON 字符串
		 */
		send(text) { sent.push(text) },
		/**
		 * 注册 mock socket 事件监听。
		 * @param {string} event 事件名
		 * @param {() => void} fn 回调
		 */
		on(event, fn) {
			const set = handlers.get(event) ?? new Set()
			set.add(fn)
			handlers.set(event, set)
		},
		/** 触发 close 以走 feedHub 注销路径。 */
		close() {
			for (const fn of handlers.get('close') ?? [])
				fn()
		},
	}
	feedHub.registerFeedSocket(username, mockSocket)
	try {
		const parent = await append.commitTimelineEvent(username, operator, {
			type: 'post',
			content: { text: 'ws parent', visibility: 'public' },
		}, { fanout: false })

		const seed = randomSeed()
		const subject = pubKeyHash(publicKeyFromSeed(seed))
		const remoteOwner = encodeEntityHash('4'.repeat(64), subject)
		await seedRemoteTimeline(username, seed, remoteOwner, [
			{ type: 'social_meta', content: { hideFromDiscovery: false, createdAt: 1 } },
			{ type: 'like', content: { targetEntityHash: operator, targetPostId: parent.id } },
		])
		await following.setFollow(username, operator, remoteOwner, true)

		const notificationFrame = sent.map(text => JSON.parse(text)).find(frame => frame.type === 'notification')
		assert(notificationFrame, 'notification WS frame')
		assertEquals(notificationFrame.notification.type, 'like')
		assert(notificationFrame.notification.aggregateKey, 'aggregateKey on WS payload')
	}
	finally {
		mockSocket.close()
	}
})

Deno.test('notificationSnippet strips markdown noise', () => {
	assertEquals(inbox.notificationSnippet('# Title\n\n**bold** text'), 'Title bold text')
})

Deno.test('aggregateNotificationRows keeps reply rows separate', () => {
	const viewer = 'a'.repeat(128)
	const rows = [
		{ type: 'reply', actorEntityHash: 'b'.repeat(128), postId: 'p1', targetPostId: 't1', at: 2 },
		{ type: 'reply', actorEntityHash: 'c'.repeat(128), postId: 'p2', targetPostId: 't2', at: 1 },
	]
	const aggregated = inbox.aggregateNotificationRows(rows, viewer)
	assertEquals(aggregated.length, 2)
})
