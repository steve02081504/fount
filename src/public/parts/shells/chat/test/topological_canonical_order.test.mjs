/**
 * topologicalCanonicalOrder 单元测试（Deno）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { topologicalCanonicalOrder } from '../../../../../scripts/p2p/dag/index.mjs'

/**
 * @param {string} id 事件 id
 * @param {string[]} prev 父 id
 * @param {number} wall HLC wall
 * @param {string} [nodeId] 节点 id
 * @returns {object} 合成事件元数据
 */
function meta(id, prev = [], wall = 0, nodeId = 'node-a') {
	return {
		id,
		prev_event_ids: prev,
		hlc: { wall, logical: 0 },
		node_id: nodeId,
		sender: 's'.repeat(64),
		type: 'message',
	}
}

Deno.test('topologicalCanonicalOrder linear chain', () => {
	const a = 'a'.repeat(64)
	const b = 'b'.repeat(64)
	const c = 'c'.repeat(64)
	const order = topologicalCanonicalOrder([
		meta(c, [b], 3),
		meta(a, [], 1),
		meta(b, [a], 2),
	])
	assertEquals(order, [a, b, c])
})

Deno.test('topologicalCanonicalOrder tie-break by hlc wall', () => {
	const a = 'a'.repeat(64)
	const b = 'b'.repeat(64)
	const order = topologicalCanonicalOrder([
		meta(b, [], 2),
		meta(a, [], 1),
	])
	assertEquals(order, [a, b])
})

Deno.test('topologicalCanonicalOrder tie-break by node_id', () => {
	const a = 'a'.repeat(64)
	const b = 'b'.repeat(64)
	const order = topologicalCanonicalOrder([
		meta(b, [], 1, 'node-z'),
		meta(a, [], 1, 'node-a'),
	])
	assertEquals(order, [a, b])
})

Deno.test('topologicalCanonicalOrder diamond DAG', () => {
	const root = '0'.repeat(64)
	const left = '1'.repeat(64)
	const right = '2'.repeat(64)
	const tip = '3'.repeat(64)
	const order = topologicalCanonicalOrder([
		meta(tip, [left, right], 4),
		meta(left, [root], 2),
		meta(right, [root], 3),
		meta(root, [], 1),
	])
	assertEquals(order.indexOf(root) < order.indexOf(left), true)
	assertEquals(order.indexOf(root) < order.indexOf(right), true)
	assertEquals(order.indexOf(left) < order.indexOf(tip), true)
	assertEquals(order.indexOf(right) < order.indexOf(tip), true)
})

Deno.test('topologicalCanonicalOrder cycle leaves partial order', () => {
	const a = 'a'.repeat(64)
	const b = 'b'.repeat(64)
	const order = topologicalCanonicalOrder([
		meta(a, [b], 1),
		meta(b, [a], 2),
	])
	assertEquals(order.length, 0)
})
