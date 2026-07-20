/**
 * pending relay 磁盘队列集成单测。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { flushPendingRelay, enqueuePendingRelay } from '../../src/chat/federation/pendingRelay.mjs'
import { createIntegrationBoot } from '../harness.mjs'

const { ensureServer, username } = createIntegrationBoot({
	username: 'pending-relay-user',
	loadParts: [],
})

Deno.test('flushPendingRelay on empty file returns 0', async () => {
	await ensureServer()
	assertEquals(await flushPendingRelay(username, '__empty_group__', async () => {}), 0)
})

Deno.test('enqueuePendingRelay skips payload without id', async () => {
	await ensureServer()
	await enqueuePendingRelay(username, 'g', { type: 'message' })
})
