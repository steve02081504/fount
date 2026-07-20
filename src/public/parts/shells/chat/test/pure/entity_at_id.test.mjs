/**
 * at-id 表述：具名 handle 时 `@handle (@hash…)`，否则 `@hash…`。
 */
/* global Deno */
import { formatEntityAtId, formatHashShort } from 'fount/public/parts/shells/chat/public/shared/entityHash.mjs'
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

const HASH = '459e5033' + 'a'.repeat(116) + 'a419'

Deno.test('formatEntityAtId：无 handle → @hash 缩写', () => {
	assertEquals(
		formatEntityAtId(HASH),
		formatHashShort(HASH, { withAt: true, headLen: 8, tailLen: 4 }),
	)
	assertEquals(formatEntityAtId(HASH), '@459e5033…a419')
})

Deno.test('formatEntityAtId：有具名 handle → @handle (@hash)', () => {
	assertEquals(
		formatEntityAtId(HASH, { handle: 'steve02081504' }),
		'@steve02081504 (@459e5033…a419)',
	)
})

Deno.test('formatEntityAtId：剥掉多余 @ 并小写化 handle', () => {
	assertEquals(
		formatEntityAtId(HASH, { handle: '@@Steve_Name' }),
		'@steve_name (@459e5033…a419)',
	)
})

Deno.test('formatEntityAtId：空白 handle 视为未设置', () => {
	assertEquals(formatEntityAtId(HASH, { handle: '   ' }), '@459e5033…a419')
	assertEquals(formatEntityAtId(HASH, { handle: null }), '@459e5033…a419')
})
