/**
 * isPlaceholderPlatformUserId 须接受 Telegram/Discord 的数字平台用户 ID。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { isPlaceholderPlatformUserId } from '../../src/chat/bridge/identity.mjs'

Deno.test('isPlaceholderPlatformUserId treats numeric ids as real', () => {
	assertEquals(isPlaceholderPlatformUserId(900001), false)
})

Deno.test('isPlaceholderPlatformUserId detects empty and your_ placeholders', () => {
	assertEquals(isPlaceholderPlatformUserId(null), true)
	assertEquals(isPlaceholderPlatformUserId(undefined), true)
	assertEquals(isPlaceholderPlatformUserId(''), true)
	assertEquals(isPlaceholderPlatformUserId('your_telegram_bot_token'), true)
	assertEquals(isPlaceholderPlatformUserId('real_user'), false)
})
