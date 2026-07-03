/**
 * events/quarantine 重放单测。
 * 复测：deno test --no-check --allow-all src/public/parts/shells/chat/test/integration/events_quarantine.test.mjs
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	appendQuarantinedEvent,
	readQuarantineRows,
	replayQuarantinedEvents,
} from '../../src/chat/events/quarantine.mjs'
import { createIntegrationBoot } from '../harness.mjs'

const { ensureServer, username } = createIntegrationBoot({
	username: 'quarantine-user',
	tempDirPrefix: 'fount_q_',
	loadParts: [],
})

Deno.test('replayQuarantinedEvents on empty quarantine returns zero', async () => {
	await ensureServer()
	const result = await replayQuarantinedEvents(username, 'empty-group', async () => ({ status: 'applied' }))
	assertEquals(result, { released: 0, remaining: 0 })
})

Deno.test('appendQuarantinedEvent and replay releases applied status', async () => {
	await ensureServer()
	const groupId = 'g-quarantine'
	const ev = { id: 'd'.repeat(64), type: 'message', groupId, sender: 'e'.repeat(64) }
	await appendQuarantinedEvent(username, groupId, ev, 'hlc_skew')
	const rows = await readQuarantineRows(username, groupId)
	assertEquals(rows.length, 1)

	const replay = await replayQuarantinedEvents(username, groupId, async () => ({ status: 'applied' }))
	assertEquals(replay.released, 1)
	assertEquals(replay.remaining, 0)
})
