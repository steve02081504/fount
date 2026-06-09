/**
 * DAG 拓扑序缓存单元测试（Deno）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	buildOrderCachePayload,
	mergeTopologicalOrder,
	resolveEventTopologicalOrder,
} from '../../../../../scripts/p2p/dag_order_cache.mjs'

/**
 * @param {string} id 事件 id
 * @param {string[]} prev 父 id
 * @param {number} wall HLC wall
 * @returns {object} 合成事件
 */
function ev(id, prev = [], wall = 0) {
	return {
		id,
		prev_event_ids: prev,
		hlc: { wall, logical: 0 },
		node_id: 'node-a',
		sender: 's'.repeat(64),
		type: 'message',
	}
}

Deno.test('mergeTopologicalOrder appends child after parent', () => {
	const e1 = ev('a'.repeat(64), [], 1)
	const e2 = ev('b'.repeat(64), [e1.id], 2)
	const order = mergeTopologicalOrder([e1.id], [e1, e2])
	assertEquals(order.length, 2)
	assertEquals(order.indexOf(e2.id) > order.indexOf(e1.id), true)
})

Deno.test('resolveEventTopologicalOrder uses cache when tips unchanged', () => {
	const e1 = ev('c'.repeat(64), [], 1)
	const e2 = ev('d'.repeat(64), [e1.id], 2)
	const events = [e1, e2]
	const full = resolveEventTopologicalOrder(events, null)
	const cache = buildOrderCachePayload(full, events)
	const again = resolveEventTopologicalOrder(events, cache)
	assertEquals(again, full)
})

Deno.test('resolveEventTopologicalOrder merges incremental events', () => {
	const e1 = ev('e'.repeat(64), [], 1)
	const e2 = ev('f'.repeat(64), [e1.id], 2)
	const base = [e1]
	const cache = buildOrderCachePayload([e1.id], base)
	const e3 = ev('0'.repeat(64), [e2.id], 3)
	const merged = resolveEventTopologicalOrder([e1, e2, e3], cache)
	assertEquals(merged.length, 3)
	assertEquals(merged.includes(e3.id), true)
})
