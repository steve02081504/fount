/**
 * buildFriendRows：好友（DM）列表构建——普通（多人）群不得混入好友列表。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { buildFriendRows } from '../../public/shared/friendRows.mjs'

const DM_HASH = 'a'.repeat(128)

Deno.test('buildFriendRows excludes non-friend-bound (created) groups', () => {
	const rows = buildFriendRows([
		{ groupId: 'g-dm', name: 'Alice', friendBinding: { entityHash: DM_HASH }, lastMessageTime: '2026-08-01T00:00:00Z' },
		{ groupId: 'g-created', name: 'My Created Group', lastMessageTime: '2026-08-02T00:00:00Z' },
	])
	assertEquals(rows.length, 1)
	assertEquals(rows[0].groupId, 'g-dm')
	assertEquals(rows.some(r => r.groupId === 'g-created'), false)
})

Deno.test('buildFriendRows keeps only groups with a valid friendBinding', () => {
	const rows = buildFriendRows([
		{ groupId: 'g-bad', name: 'No Hash', friendBinding: { charname: 'X' } },
		{ groupId: 'g-good', name: 'Bob', friendBinding: { entityHash: DM_HASH, charname: 'Bob' } },
	])
	assertEquals(rows.length, 1)
	assertEquals(rows[0].groupId, 'g-good')
	assertEquals(rows[0].key, DM_HASH)
	assertEquals(rows[0].charname, 'Bob')
})

Deno.test('buildFriendRows dedupes by entityHash keeping the newer session', () => {
	const rows = buildFriendRows([
		{ groupId: 'g-old', name: 'Alice', friendBinding: { entityHash: DM_HASH }, lastMessageTime: '2026-08-01T00:00:00Z' },
		{ groupId: 'g-new', name: 'Alice', friendBinding: { entityHash: DM_HASH }, lastMessageTime: '2026-08-03T00:00:00Z' },
	])
	assertEquals(rows.length, 1)
	assertEquals(rows[0].groupId, 'g-new')
})

Deno.test('buildFriendRows sorts by lastMessageTime desc then displayName', () => {
	const rows = buildFriendRows([
		{ groupId: 'g-old', name: 'Old', friendBinding: { entityHash: 'b'.repeat(128) }, lastMessageTime: '2026-08-01T00:00:00Z' },
		{ groupId: 'g-new', name: 'New', friendBinding: { entityHash: 'c'.repeat(128) }, lastMessageTime: '2026-08-03T00:00:00Z' },
		{ groupId: 'g-tie', name: 'AAA', friendBinding: { entityHash: 'd'.repeat(128) }, lastMessageTime: '2026-08-02T00:00:00Z' },
	])
	assertEquals(rows.map(r => r.groupId), ['g-new', 'g-tie', 'g-old'])
})
