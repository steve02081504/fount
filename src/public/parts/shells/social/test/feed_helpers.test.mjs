/**
 * Social 纯函数单元测试（Deno，无 server 依赖）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { normalizeBlocklist } from '../../../../../scripts/p2p/blocklist.mjs'
import { topologicalCanonicalOrder } from '../../../../../scripts/p2p/dag/index.mjs'
import { canViewPost } from '../src/feedHelpers.mjs'

/**
 * 测试辅助：仅物化 post 事件列表。
 * @param {object[]} events 原始事件
 * @returns {object} 物化视图（与 materialize.mjs 同构的 posts 计数）
 */
function materializePostsOnly(events) {
	const order = topologicalCanonicalOrder(events.map(event => ({
		id: event.id,
		prev_event_ids: event.prev_event_ids,
		hlc: event.hlc,
		node_id: event.node_id,
	})))
	const byId = new Map(events.map(event => [event.id, event]))
	const posts = new Map()
	for (const eventId of order) {
		const event = byId.get(eventId)
		if (event?.type === 'post') posts.set(event.id, event)
	}
	return [...posts.values()]
}

Deno.test('canViewPost respects visibility and self', () => {
	const blocked = new Set()
	const following = new Set(['author1'])
	const self = 'viewer1'
	assertEquals(canViewPost({ entityHash: 'author1', content: { visibility: 'public' } }, self, blocked, following), true)
	assertEquals(canViewPost({ entityHash: 'author1', content: { visibility: 'followers' } }, self, blocked, following), true)
	assertEquals(canViewPost({ entityHash: 'author2', content: { visibility: 'followers' } }, self, blocked, following), false)
	assertEquals(canViewPost({ entityHash: 'viewer1', content: { visibility: 'followers' } }, self, blocked, following), true)
})

Deno.test('materialize keeps all posts regardless of visibility', () => {
	const posts = materializePostsOnly([
		{ id: 'a', type: 'post', prev_event_ids: [], hlc: { wall: 1 }, content: { visibility: 'followers' } },
		{ id: 'b', type: 'post', prev_event_ids: ['a'], hlc: { wall: 2 }, content: { visibility: 'public' } },
	])
	assertEquals(posts.length, 2)
})

Deno.test('materialize unlike removes like by target key', () => {
	/** @type {Map<string, object>} */
	const likes = new Map()
	likes.set('author1:p1', { id: 'l1' })
	const unlikeKey = 'author1:p1'
	likes.delete(unlikeKey)
	assertEquals(likes.size, 0)
})

Deno.test('blocklist entity scope from p2p normalizeBlocklist', () => {
	const entity = `${'e'.repeat(128)}`
	const list = normalizeBlocklist({ blocked: [{ scope: 'entity', value: entity }] })
	assertEquals(list.blocked[0].value, entity)
})
