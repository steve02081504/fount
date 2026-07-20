/**
 * profile/syncFromPersona 单测。
 * 复测：deno test --no-check --allow-scripts --allow-all src/public/parts/shells/chat/test/integration/profile_sync.test.mjs
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { encodeEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import { createIntegrationBoot } from '../harness.mjs'

const { ensureServer, username } = createIntegrationBoot({
	username: 'profile-sync-user',
	minP2pNode: true,
})

Deno.test('syncEntityProfileFromPersona skips non-writable foreign entityHash', async () => {
	await ensureServer()
	const { isWritableLocalEntity } = await import('../../src/chat/lib/replica.mjs')
	const foreign = encodeEntityHash('b'.repeat(64), 'c'.repeat(64))
	assertEquals(isWritableLocalEntity(foreign), false)
	const { syncEntityProfileFromPersona } = await import('../../src/profile/syncFromPersona.mjs')
	await syncEntityProfileFromPersona(username, 'missing-group')
})
