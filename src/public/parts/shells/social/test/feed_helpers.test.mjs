/**
 * Social 纯函数单元测试（Deno，无 server 依赖）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { normalizeBlocklist } from '../../../../../scripts/p2p/blocklist.mjs'
import { topologicalCanonicalOrder } from '../../../../../scripts/p2p/dag/index.mjs'
import { isAuthorFilteredByPersonalSets } from '../../../../../scripts/p2p/personal_block.mjs'
import { canViewPost } from '../src/feedVisibility.mjs'

/**
 * @param {object[]} events 原始事件
 * @returns {object[]}
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

Deno.test('canViewPost respects visibility with implicit self-follow', () => {
	const viewerContext = {
		viewerEntityHash: 'viewer1',
		following: new Set(['author1', 'viewer1']),
		personalFilter: {
			blockedEntityHashes: new Set(),
			blockedSubjects: new Set(),
			hiddenEntityHashes: new Set(),
			hiddenSubjects: new Set(),
		},
	}
	assertEquals(canViewPost({ entityHash: 'author1', content: { visibility: 'public' } }, viewerContext), true)
	assertEquals(canViewPost({ entityHash: 'author2', content: { visibility: 'followers' } }, viewerContext), false)
	assertEquals(canViewPost({ entityHash: 'viewer1', content: { visibility: 'followers' } }, viewerContext), true)
})

Deno.test('canViewPost hides personally blocked authors', () => {
	const viewerContext = {
		viewerEntityHash: 'viewer1',
		following: new Set(['viewer1', 'bad']),
		personalFilter: {
			blockedEntityHashes: new Set(['bad']),
			blockedSubjects: new Set(),
			hiddenEntityHashes: new Set(),
			hiddenSubjects: new Set(),
		},
	}
	assertEquals(canViewPost({ entityHash: 'bad', content: { visibility: 'public' } }, viewerContext), false)
})

Deno.test('isAuthorFilteredByPersonalSets subject scope', () => {
	const pk = 'a'.repeat(64)
	const filterSets = {
		blockedEntityHashes: new Set(),
		blockedSubjects: new Set([pk]),
		hiddenEntityHashes: new Set(),
		hiddenSubjects: new Set(),
	}
	assertEquals(isAuthorFilteredByPersonalSets(filterSets, 'b'.repeat(64) + pk), true)
})

Deno.test('materialize keeps all posts regardless of visibility', () => {
	const posts = materializePostsOnly([
		{ id: 'a', type: 'post', prev_event_ids: [], hlc: { wall: 1 }, content: { visibility: 'followers' } },
		{ id: 'b', type: 'post', prev_event_ids: ['a'], hlc: { wall: 2 }, content: { visibility: 'public' } },
	])
	assertEquals(posts.length, 2)
})

Deno.test('blocklist entity scope from p2p normalizeBlocklist', () => {
	const entity = `${'e'.repeat(128)}`
	const list = normalizeBlocklist({ blocked: [{ scope: 'entity', value: entity }] })
	assertEquals(list.blocked[0].value, entity)
})
