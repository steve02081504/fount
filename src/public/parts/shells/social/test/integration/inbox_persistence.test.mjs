/**
 * M5：inbox 持久化 + 已读水位 + buildNotifications unreadCount。
 */
/* global Deno */
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

Deno.test('local commit writes inbox for reply recipient', async () => {
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
	assert(rows.some(row => row.type === 'reply' && row.targetPostId === target.id))
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

		await append.commitTimelineEvent(username, operator, {
			type: 'post',
			content: {
				text: 'ws reply',
				visibility: 'public',
				replyTo: { entityHash: operator, postId: parent.id },
			},
		}, { fanout: false })

		const notificationFrame = sent.map(text => JSON.parse(text)).find(frame => frame.type === 'notification')
		assert(notificationFrame, 'notification WS frame')
		assertEquals(notificationFrame.notification.type, 'reply')
	}
	finally {
		mockSocket.close()
	}
})
