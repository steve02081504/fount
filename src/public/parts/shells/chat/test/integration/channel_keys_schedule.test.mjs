/**
 * channel_keys/schedule 单测。
 * 复测：deno test --no-check --allow-all src/public/parts/shells/chat/test/integration/channel_keys_schedule.test.mjs
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createIntegrationBoot } from '../harness.mjs'

const { ensureServer, username } = createIntegrationBoot({
	username: 'ck-schedule-user',
	tempDirPrefix: 'fount_ck_schedule_',
	minP2pNode: true,
})

Deno.test('appendChannelKeyRotate returns null for empty channelId', async () => {
	await ensureServer()
	const { appendChannelKeyRotate } = await import('../../src/chat/channel_keys/schedule.mjs')
	const result = await appendChannelKeyRotate(username, 'group', '')
	assertEquals(result, null)
})

Deno.test('ensureChannelKey no-ops for empty channelId', async () => {
	await ensureServer()
	const { ensureChannelKey } = await import('../../src/chat/channel_keys/schedule.mjs')
	await ensureChannelKey(username, 'group', '  ')
})
