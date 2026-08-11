/**
 * 分叉时频道消息应按 tip 祖先闭包过滤。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { filterChannelMessageLinesByBranchTip } from '../../public/shared/branchMessageFilter.mjs'

const tipA = 'a'.repeat(64)
const tipB = 'b'.repeat(64)
const root = 'c'.repeat(64)

Deno.test('filterChannelMessageLinesByBranchTip drops off-branch message rows', () => {
	const events = [
		{ id: root, prev_event_ids: [] },
		{ id: tipA, prev_event_ids: [root] },
		{ id: tipB, prev_event_ids: [root] },
	]
	const lines = [
		{ eventId: root, content: { text: '0' } },
		{ eventId: tipA, content: { text: '1' } },
		{ eventId: tipB, content: { text: '1' } },
	]
	const filtered = filterChannelMessageLinesByBranchTip(lines, tipA, events)
	assertEquals(filtered.map(row => row.eventId), [root, tipA])
})

Deno.test('filterChannelMessageLinesByBranchTip returns all when tip missing', () => {
	const lines = [{ eventId: tipA }, { eventId: tipB }]
	assertEquals(filterChannelMessageLinesByBranchTip(lines, '', []).length, 2)
})
