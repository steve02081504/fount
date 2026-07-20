/**
 * 桥接群生命周期事件 → char OnGroupEvent 分发。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { groupEventProbe } from '../fixtures/probes/groupEventProbe.mjs'
import { createCharBoot } from '../harness.mjs'

const CHAR = 'on_message_yes'

Deno.test('postBridgeGroupEvent dispatches to char OnGroupEvent with member identity', async () => {
	const username = `bridge-gev-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createCharBoot({ username, chars: CHAR })
	await ensureServer()

	const { postBridgeGroupEvent } = await import('../../src/chat/bridge/groupEvents.mjs')
	const { ensureBridgeGroup } = await import('../../src/chat/bridge/registry.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { bridgeEntityHash } = await import('../../src/chat/bridge/identity.mjs')

	groupEventProbe.reset()
	const platformChatId = 950001
	const { groupId } = await ensureBridgeGroup(username, {
		platform: 'telegram',
		platformChatId,
		chatKind: 'group',
		name: 'group-events',
		botname: 'gev-bot',
	})
	await addchar(groupId, CHAR, username)

	await postBridgeGroupEvent(username, {
		type: 'bot_joined_group',
		platform: 'telegram',
		platformChatId,
		chatName: 'group-events',
		botname: 'gev-bot',
	})
	await postBridgeGroupEvent(username, {
		type: 'member_left',
		platform: 'telegram',
		platformChatId,
		member: { platformUserId: 31337, displayName: 'Leaver' },
		botname: 'gev-bot',
	})

	const probe = groupEventProbe.events
	assertEquals(probe.length, 2)
	assertEquals(probe[0].type, 'bot_joined_group')
	assertEquals(probe[0].group.groupId, groupId)
	assert(probe[0].channel?.channelId)
	assertEquals(probe[1].type, 'member_left')
	assertEquals(probe[1].member.platformUserId, '31337')
	assertEquals(probe[1].member.displayName, 'Leaver')
	assertEquals(probe[1].member.entityHash, bridgeEntityHash('telegram', 31337))
})

Deno.test('dispatchBridgeBotStarted hits only mapped groups of matching bot', async () => {
	const username = `bridge-bst-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createCharBoot({ username, chars: CHAR })
	await ensureServer()

	const { dispatchBridgeBotStarted } = await import('../../src/chat/bridge/groupEvents.mjs')
	const { ensureBridgeGroup } = await import('../../src/chat/bridge/registry.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')

	groupEventProbe.reset()
	const { groupId: mineGroupId } = await ensureBridgeGroup(username, {
		platform: 'telegram',
		platformChatId: 950002,
		chatKind: 'group',
		name: 'mine',
		botname: 'bot-a',
	})
	await addchar(mineGroupId, CHAR, username)
	const { groupId: otherGroupId } = await ensureBridgeGroup(username, {
		platform: 'telegram',
		platformChatId: 950003,
		chatKind: 'group',
		name: 'other-bot',
		botname: 'bot-b',
	})
	await addchar(otherGroupId, CHAR, username)

	await dispatchBridgeBotStarted(username, 'telegram', 'bot-a')

	const probe = groupEventProbe.events
	assertEquals(probe.length, 1)
	assertEquals(probe[0].type, 'bot_started')
	assertEquals(probe[0].group.groupId, mineGroupId)
})
