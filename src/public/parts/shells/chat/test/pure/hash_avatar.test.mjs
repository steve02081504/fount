/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	avatarColor,
	avatarInitial,
	avatarTextColor,
	hashAvatarRgb,
	hashAvatarStyle,
	isFirstMessageInAuthorGroup,
	MESSAGE_AVATAR_GROUP_GAP_MS,
} from 'fount/public/parts/shells/chat/public/shared/hashAvatar.mjs'

const SEED = 'a'.repeat(128)

Deno.test('hashAvatar: same seed yields stable rgb and inverse text color', () => {
	const bg = hashAvatarRgb(SEED)
	const style = hashAvatarStyle(SEED)
	assertEquals(avatarColor(SEED), style.background)
	assertEquals(avatarTextColor(SEED), style.color)
	assertEquals(style.color, `rgb(${255 - bg.r}, ${255 - bg.g}, ${255 - bg.b})`)
	assertEquals(avatarColor(SEED), avatarColor(SEED))
	assertNotSameColorAcrossSeeds()
})

/**
 * @returns {void}
 */
function assertNotSameColorAcrossSeeds() {
	const a = avatarColor(SEED)
	const b = avatarColor('b'.repeat(128))
	assert(a !== b, 'different seeds should differ')
}

Deno.test('hashAvatar: avatarInitial uses first letter', () => {
	assertEquals(avatarInitial('test_streamer'), 'T')
	assertEquals(avatarInitial(''), '?')
})

Deno.test('isFirstMessageInAuthorGroup: char vs human same sender pubKey still breaks group', () => {
	const host = 'f'.repeat(64)
	assertEquals(isFirstMessageInAuthorGroup('test_streamer', host, 1000, 500), true)
	assertEquals(isFirstMessageInAuthorGroup(host, 'test_streamer', 1000, 500), true)
})

Deno.test('isFirstMessageInAuthorGroup: same author within 30min hides repeat avatar', () => {
	const t = 1_000_000
	assertEquals(isFirstMessageInAuthorGroup('alice', 'alice', t, t - 60_000), false)
	assertEquals(
		isFirstMessageInAuthorGroup('alice', 'alice', t, t - MESSAGE_AVATAR_GROUP_GAP_MS - 1),
		true,
	)
})

Deno.test('isFirstMessageInAuthorGroup: first message always shows avatar', () => {
	assertEquals(isFirstMessageInAuthorGroup('alice', null, 0, 0), true)
})

Deno.test('isAvatarImageUrl distinguishes URL from emoji avatar', async () => {
	const { isAvatarImageUrl } = await import('fount/public/parts/shells/chat/public/shared/hashAvatar.mjs')
	assertEquals(isAvatarImageUrl('https://x.test/a.png'), true)
	assertEquals(isAvatarImageUrl('/api/foo'), true)
	assertEquals(isAvatarImageUrl('🤖'), false)
})
