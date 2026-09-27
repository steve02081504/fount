/* global Deno */
/**
 * charWakeRegistry 纯测试：槽位键编码与共享调度器单例。
 */
import { assertEquals } from 'jsr:@std/assert'

import { chatReplyWakes, charReplyFlightKey } from '../../src/chat/session/charWakeRegistry.mjs'

Deno.test('charReplyFlightKey falls back to default channel', () => {
	assertEquals(charReplyFlightKey('g', null, 'c'), 'g\0default\0c')
	assertEquals(charReplyFlightKey('g', undefined, 'c'), 'g\0default\0c')
	assertEquals(charReplyFlightKey('g', 'general', 'c'), 'g\0general\0c')
})

Deno.test('chatReplyWakes is a shared wake scheduler singleton', () => {
	const key = charReplyFlightKey('g', 'general', 'c')
	assertEquals(chatReplyWakes.tryBegin(key), true)
	assertEquals(chatReplyWakes.isRunning(key), true)
	chatReplyWakes.mark(key)
	assertEquals(chatReplyWakes.release(key), true)
	assertEquals(chatReplyWakes.isRunning(key), false)
})
