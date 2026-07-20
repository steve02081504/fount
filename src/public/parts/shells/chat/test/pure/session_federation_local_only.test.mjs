/**
 * session_* 联邦入站硬拒；本地仍允许形状校验。
 */
/* global Deno */
import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'

const { validateIngestAuthz } = await import('../../src/chat/dag/ingest.mjs')

const localSessionEvent = {
	type: 'session_world_bind',
	sender: 'a'.repeat(64),
	content: { worldname: 'w', distribution: 'local', ownerUsername: 'u' },
}

Deno.test('validateIngestAuthz rejects federated session_world_bind', async () => {
	await assertRejects(
		() => validateIngestAuthz('u', 'g', localSessionEvent, {
			source: 'federation',
			state: { members: { ['a'.repeat(64)]: { status: 'active' } }, groupSettings: {} },
		}),
		Error,
		'session events are local-only',
	)
})

Deno.test('validateIngestAuthz allows local session_world_bind shape', async () => {
	await validateIngestAuthz('u', 'g', localSessionEvent, {
		source: 'local',
		state: { members: {}, groupSettings: {} },
	})
	assertEquals(true, true)
})
