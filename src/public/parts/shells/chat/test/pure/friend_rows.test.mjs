/**
 * buildFriendRows：好友（DM）列表构建——普通（多人）群不得混入好友列表。
 * friendAvatarTemplateFields：好友行头像字段——对端 profile 头像应进入 avatarInner（DM 好友修复的回归守卫）。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { buildFriendRows, friendAvatarTemplateFields } from '../../public/shared/friendRows.mjs'

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
		{ groupId: 'g-old-b', name: 'Bravo', friendBinding: { entityHash: 'b'.repeat(128) }, lastMessageTime: '2026-08-01T00:00:00Z' },
		{ groupId: 'g-old-a', name: 'Alpha', friendBinding: { entityHash: 'a'.repeat(128) }, lastMessageTime: '2026-08-01T00:00:00Z' },
		{ groupId: 'g-new', name: 'New', friendBinding: { entityHash: 'c'.repeat(128) }, lastMessageTime: '2026-08-03T00:00:00Z' },
		{ groupId: 'g-tie', name: 'AAA', friendBinding: { entityHash: 'd'.repeat(128) }, lastMessageTime: '2026-08-02T00:00:00Z' },
	])
	// 时间倒序；同一时间（08-01）的两行按 displayName 升序（Alpha 在 Bravo 前）。
	assertEquals(rows.map(row => row.groupId), ['g-new', 'g-tie', 'g-old-a', 'g-old-b'])
})

Deno.test('friendAvatarTemplateFields renders DM friend profile avatar as img', () => {
	const friend = {
		groupId: 'g-dm',
		key: DM_HASH,
		displayName: 'Alice',
		binding: { entityHash: DM_HASH },
	}
	const fields = friendAvatarTemplateFields(friend, { avatar: 'https://example.test/alice.png' }, 'Alice')
	assert(fields.avatarInner.includes('<img'), 'DM 好友的 profile 头像应渲染为 <img>')
	assert(fields.avatarInner.includes('https://example.test/alice.png'))
	assertEquals(fields.avatarFor, DM_HASH)
})

Deno.test('friendAvatarTemplateFields letter fallback still carries avatarFor for DM hydration', () => {
	const friend = {
		groupId: 'g-dm',
		key: DM_HASH,
		displayName: 'Alice',
		binding: { entityHash: DM_HASH },
	}
	const fields = friendAvatarTemplateFields(friend, null, 'Alice')
	assert(!fields.avatarInner.includes('<img'), '无头像资料应回退字母占位')
	assertEquals(fields.avatarFor, DM_HASH, 'DM 好友即使暂未取到资料也须带 avatarFor 供 applyAvatarsTo 异步补齐')
	assert(fields.avatarBg && fields.avatarTextColor, '字母占位应带 hash 配色')
})

Deno.test('friendAvatarTemplateFields char friends render profile avatar and carry avatarFor', () => {
	const friend = {
		groupId: 'g-char',
		key: DM_HASH,
		displayName: 'Char',
		charname: 'my_char',
		binding: { entityHash: DM_HASH, charname: 'my_char' },
	}
	const fields = friendAvatarTemplateFields(friend, { avatar: 'https://example.test/char.png' }, 'Char')
	assert(fields.avatarInner.includes('https://example.test/char.png'))
	assertEquals(fields.avatarFor, DM_HASH)
})
