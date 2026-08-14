/**
 * pending 登录过期清理。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { deletePending, getPending, putPending, sweepExpired } from '../../src/pending.mjs'

Deno.test('sweepExpired closes hook of stale sessions without waiting for Map access', () => {
	const hook = { closed: false, /**
	 *
	 */
		close: async () => { hook.closed = true } }
	putPending('stale', { username: 'u', hook })
	try {
		getPending('stale').createdAt = 0
		sweepExpired()
		assertEquals(getPending('stale'), undefined)
		assertEquals(hook.closed, true)
	}
	finally {
		deletePending('stale')
	}
})

Deno.test('deletePending clears the expiry timer', () => {
	putPending('live', { username: 'u' })
	deletePending('live')
	assertEquals(getPending('live'), undefined)
})
