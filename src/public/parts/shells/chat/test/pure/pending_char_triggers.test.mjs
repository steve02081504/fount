/* global Deno */
/**
 * pendingCharTriggers 纯测试：槽位键格式与 mark/take/clear 语义。
 */
import { assertEquals } from 'jsr:@std/assert'

import {
	charReplyFlightKey,
	clearPendingCharTrigger,
	markPendingCharTrigger,
	takePendingCharTrigger,
} from '../../src/chat/session/pendingCharTriggers.mjs'

Deno.test('charReplyFlightKey falls back to default channel', () => {
	assertEquals(charReplyFlightKey('g', null, 'c'), 'g\0default\0c')
	assertEquals(charReplyFlightKey('g', 'general', 'c'), 'g\0general\0c')
})

Deno.test('take consumes the mark and reports whether it was set', () => {
	const key = charReplyFlightKey('g', 'general', 'c')
	assertEquals(takePendingCharTrigger(key), false)
	markPendingCharTrigger(key)
	assertEquals(takePendingCharTrigger(key), true)
	assertEquals(takePendingCharTrigger(key), false, '取出后不再存在')
})

Deno.test('clear removes the mark without reporting', () => {
	const key = charReplyFlightKey('g', 'general', 'c')
	markPendingCharTrigger(key)
	clearPendingCharTrigger(key)
	assertEquals(takePendingCharTrigger(key), false)
})
