/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { topologicalCanonicalOrder } from '../dag/index.mjs'
import {
	descendantClosureFromTip,
} from '../governance_branch.mjs'
import { computeRetentionKeepIds, PERMISSION_ANCHOR_TYPES } from '../retention_policy.mjs'

/**
 * 构造固定长度十六进制串。
 * @param {string} c 重复字符
 * @returns {string} 64 字符测试哈希
 */
const hex = c => c.repeat(64)

Deno.test('descendantClosureFromTip keeps connected suffix not topo slice orphans', () => {
	const root = hex('0')
	const left = hex('1')
	const right = hex('2')
	const tip = hex('3')
	const orphan = hex('4')
	const events = [
		{ id: tip, prev_event_ids: [left, right] },
		{ id: orphan, prev_event_ids: [left] },
		{ id: left, prev_event_ids: [root] },
		{ id: right, prev_event_ids: [root] },
		{ id: root, prev_event_ids: [] },
	]
	const byId = new Map(events.map(e => [e.id, e]))
	const keep = descendantClosureFromTip(tip, byId)
	assertEquals(keep.has(tip), true)
	assertEquals(keep.has(orphan), false)
	assertEquals(keep.size, 1)
})

Deno.test('computeRetentionKeepIds depth retains ancestor chain on branch', () => {
	const e1 = hex('1')
	const e2 = hex('2')
	const e3 = hex('3')
	const e4 = hex('4')
	const events = [
		{ id: e1, type: 'message', prev_event_ids: [], hlc: { wall: 1, logical: 0 } },
		{ id: e2, type: 'message', prev_event_ids: [e1], hlc: { wall: 2, logical: 0 } },
		{ id: e3, type: 'message', prev_event_ids: [e2], hlc: { wall: 3, logical: 0 } },
		{ id: e4, type: 'message', prev_event_ids: [e3], hlc: { wall: 4, logical: 0 } },
	]
	const byId = new Map(events.map(e => [e.id, e]))
	const order = topologicalCanonicalOrder(events)
	const keep = computeRetentionKeepIds(order, byId, {
		maxDepth: 2,
		cutoffWall: 0,
		anchorTypes: PERMISSION_ANCHOR_TYPES,
		branchTipId: e4,
	})
	assertEquals(keep.size, 4)
})
