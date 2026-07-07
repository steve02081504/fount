/**
 * events/retention 单测：保留策略 keepIds。
 * 复测：deno test --no-check --allow-scripts --allow-all src/public/parts/shells/chat/test/pure/events_retention.test.mjs
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { computeRetentionKeepIds } from '../../../../../../scripts/p2p/retention_policy.mjs'
import { PERMISSION_ANCHOR_TYPES } from '../../src/chat/dag/eventTypes.mjs'

Deno.test('computeRetentionKeepIds keeps recent branch tail', () => {
	const a = 'a'.repeat(64)
	const b = 'b'.repeat(64)
	const c = 'c'.repeat(64)
	const events = [
		{ id: a, type: 'member_join', prev_event_ids: [], hlc: { wall: 1 }, timestamp: 1 },
		{ id: b, type: 'message', prev_event_ids: [a], hlc: { wall: 2 }, timestamp: 2 },
		{ id: c, type: 'message', prev_event_ids: [b], hlc: { wall: 3 }, timestamp: 3 },
	]
	const byId = new Map(events.map(e => [e.id, e]))
	const order = [a, b, c]
	const keep = computeRetentionKeepIds(order, byId, {
		maxDepth: 10,
		cutoffWall: 0,
		anchorTypes: PERMISSION_ANCHOR_TYPES,
		checkpointTipId: null,
		branchTipId: null,
	})
	assertEquals(keep.has(c), true)
	assertEquals(keep.size >= 1, true)
})
