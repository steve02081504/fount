/**
 * feed 归并 / engagement / feedHub 推送。
 * 复测：deno test --no-check --allow-scripts --allow-all src/public/parts/shells/social/test/integration/feed_merge.test.mjs
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createTestSession } from '../harness.mjs'

const getSession = createTestSession()

const append = await import('../../src/timeline/append.mjs')
const feedMerge = await import('../../src/feedMerge.mjs')
const feedHelpers = await import('../../src/feed.mjs')
const buildItem = await import('../../src/feed/buildItem.mjs')
const feedHub = await import('../../src/ws/feedHub.mjs')

Deno.test('compareFeedItems orders newer hlc first', () => {
	const older = { hlc: { wall: 100 }, postId: 'a'.repeat(64), repPenalty: 0 }
	const newer = { hlc: { wall: 200 }, postId: 'b'.repeat(64), repPenalty: 0 }
	assert(feedMerge.compareFeedItems(newer, older) > 0)
	assert(feedMerge.compareFeedItems(older, newer) < 0)
})

Deno.test('kWayMergeFeedStreams merges sorted streams', () => {
	const streams = [
		{ candidates: [{ hlc: { wall: 300 }, postId: 'c'.repeat(64) }], index: 0 },
		{ candidates: [{ hlc: { wall: 200 }, postId: 'b'.repeat(64) }], index: 0 },
	]
	const merged = feedMerge.kWayMergeFeedStreams(streams, 2)
	assertEquals(merged.length, 2)
	assertEquals(merged[0].hlc.wall, 300)
})

Deno.test('buildEngagementIndex counts likes and reposts', async () => {
	const { username, operator } = await getSession()
	const post = await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'engage me', visibility: 'public' },
	}, { fanout: false })
	await append.commitTimelineEvent(username, operator, {
		type: 'like',
		content: { targetEntityHash: operator, targetPostId: post.id },
	}, { fanout: false })
	await append.commitTimelineEvent(username, operator, {
		type: 'repost',
		content: { targetEntityHash: operator, targetPostId: post.id, comment: '' },
	}, { fanout: false })

	const engagement = await feedHelpers.buildEngagementIndex(username, [operator])
	const viewerLiked = await feedHelpers.buildViewerLikedSet(username)
	const forPost = buildItem.createEngagementForPost(engagement, viewerLiked)
	const stats = forPost(operator, post.id)
	assertEquals(stats.likeCount, 1)
	assertEquals(stats.repostCount, 1)
	assert(stats.viewerLiked)
})

Deno.test('pushFeedUpdate sends to registered mock socket', async () => {
	const { username } = await getSession()
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
		feedHub.pushFeedUpdate(username, { type: 'feed_refresh', at: 1 })
		assertEquals(sent.length, 1)
		const payload = JSON.parse(sent[0])
		assertEquals(payload.type, 'feed_refresh')
	}
	finally {
		mockSocket.close()
	}
})
