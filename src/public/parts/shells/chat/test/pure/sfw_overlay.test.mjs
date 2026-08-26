/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { applySfwOverlay } from 'fount/scripts/sfw.mjs'

Deno.test('applySfwOverlay copies sfw_* onto base keys', () => {
	const out = applySfwOverlay({
		name: 'nsfw',
		avatar: '🔥',
		sfw_name: 'safe',
		sfw_avatar: '🙂',
		tags: ['a'],
	})
	assertEquals(out.name, 'safe')
	assertEquals(out.avatar, '🙂')
	assertEquals(out.sfw_name, 'safe')
	assertEquals(out.tags, ['a'])
})

Deno.test('applySfwOverlay returns falsy input as-is', () => {
	assertEquals(applySfwOverlay(null), null)
	assertEquals(applySfwOverlay(undefined), undefined)
})
