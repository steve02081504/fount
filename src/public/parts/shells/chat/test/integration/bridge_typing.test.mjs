/**
 * bridge typing ingress + channel.typingUsers
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createIntegrationBoot } from '../harness.mjs'

Deno.test('postBridgeTyping and channel.typingUsers', async () => {
	const username = `typing-${crypto.randomUUID().slice(0, 8)}`
	const boot = createIntegrationBoot({
		username,
		minP2pNode: true,
	})
	await boot.ensureServer()

	const { ensureBridgeGroup } = await import('../../src/chat/bridge/registry.mjs')
	const { postBridgeTyping, listTypingEntities } = await import('../../src/chat/bridge/typing.mjs')
	const { bindBridgeIdentity } = await import('../../src/chat/bridge/identity.mjs')
	const { getChatClient } = await import('../../src/api/client/index.mjs')

	const platformChatId = 770000 + Math.floor(Math.random() * 1000)
	const { groupId } = await ensureBridgeGroup(username, {
		platform: 'discord',
		platformChatId,
		chatKind: 'group',
	})
	await bindBridgeIdentity(username, {
		platform: 'discord',
		platformUserId: '99001',
		entityHash: 'a'.repeat(64) + 'b'.repeat(64),
		displayName: 'Typer',
	})

	await postBridgeTyping(username, {
		platform: 'discord',
		platformChatId,
		platformUserId: '99001',
		displayName: 'Typer',
	})

	const hashes = listTypingEntities(username, groupId, 'default')
	assertEquals(hashes.length, 1)

	const client = await getChatClient(username)
	const channel = await (await client.group(groupId)).channel('default')
	const users = await channel.typingUsers()
	assert(users.length >= 1)
})
