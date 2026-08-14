/**
 * pending 登录过期清理。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { deletePending, getPending, putPending, sweepExpired } from '../../src/pending.mjs'

Deno.test('sweepExpired closes hook of stale sessions without waiting for Map access', async () => {
	const hook = {
		closed: false,
		/**
		 * 标记 hook 已关闭。
		 * @returns {Promise<void>}
		 */
		close: async () => { hook.closed = true },
	}
	putPending('stale', { username: 'u', hook })
	try {
		getPending('stale').createdAt = 0
		await sweepExpired()
		assertEquals(getPending('stale'), undefined)
		assertEquals(hook.closed, true)
	}
	finally {
		await deletePending('stale')
	}
})

Deno.test('sweepExpired waits for hook.close before returning', async () => {
	let release
	const closed = new Promise(resolve => { release = resolve })
	const hook = {
		/**
		 * 卡住直到测试放行。
		 * @returns {Promise<void>}
		 */
		close: () => closed,
	}
	putPending('stale-wait', { username: 'u', hook })
	try {
		getPending('stale-wait').createdAt = 0
		const sweeping = sweepExpired()
		assertEquals(await Promise.race([sweeping.then(() => 'finished'), Promise.resolve('pending')]), 'pending')
		release()
		await sweeping
		assertEquals(getPending('stale-wait'), undefined)
	}
	finally {
		await deletePending('stale-wait')
	}
})

Deno.test('deletePending clears the expiry timer', async () => {
	putPending('live', { username: 'u' })
	await deletePending('live')
	assertEquals(getPending('live'), undefined)
})
