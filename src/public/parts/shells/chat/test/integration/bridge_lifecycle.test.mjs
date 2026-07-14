/**
 * per-bot bridgeOperations 生命周期集成测试。
 */
/* global Deno */
import { assert, assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createIntegrationBoot } from '../harness.mjs'

Deno.test('per-bot bridgeOperations: two bots on same platform route independently', async () => {
	const username = `bridge-lifecycle-parallel-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_lifecycle_parallel_',
		minP2pNode: true,
	})
	await ensureServer()

	const { registerBridgeOperations, requireBridgeOperation } = await import('../../src/chat/bridge/operations.mjs')
	const { appendSignedLocalEvent } = await import('../../src/chat/dag/append.mjs')
	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')

	const callsA = []
	const callsB = []
	registerBridgeOperations(username, 'telegram', 'bot-a', {
		/**
		 *
		 */
		sendTyping: async () => { callsA.push('typing') },
	})
	registerBridgeOperations(username, 'telegram', 'bot-b', {
		/**
		 *
		 */
		sendTyping: async () => { callsB.push('typing') },
	})

	const groupA = await newGroup(username, { name: 'bot-a-group' })
	await appendSignedLocalEvent(username, groupA, {
		type: 'group_settings_update',
		timestamp: Date.now(),
		content: { bridge: { platform: 'telegram', platformChatId: '1001', chatKind: 'group', botname: 'bot-a' } },
	})

	const groupB = await newGroup(username, { name: 'bot-b-group' })
	await appendSignedLocalEvent(username, groupB, {
		type: 'group_settings_update',
		timestamp: Date.now(),
		content: { bridge: { platform: 'telegram', platformChatId: '1002', chatKind: 'group', botname: 'bot-b' } },
	})

	await requireBridgeOperation(username, { platform: 'telegram', botname: 'bot-a' }, 'sendTyping')({ platformChatId: '1001' })
	await requireBridgeOperation(username, { platform: 'telegram', botname: 'bot-b' }, 'sendTyping')({ platformChatId: '1002' })

	assertEquals(callsA, ['typing'])
	assertEquals(callsB, ['typing'])
})

Deno.test('unregisterBridgeOperations clears registry and outbound handlers', async () => {
	const username = `bridge-lifecycle-unreg-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_lifecycle_unreg_',
		minP2pNode: true,
	})
	await ensureServer()

	const { registerBridgeOperations, unregisterBridgeOperations, requireBridgeOperation, resolveBridgeOperations } =
		await import('../../src/chat/bridge/operations.mjs')
	const { registerBridgeOutbound, notifyBridgeOutbound } = await import('../../src/chat/bridge/outbound.mjs')
	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')

	const groupId = await newGroup(username, { name: 'outbound-clear' })
	/** @type {object[]} */
	const outboundLines = []
	registerBridgeOperations(username, 'mock', 'clear-bot', {
		/**
		 *
		 */
		sendTyping: async () => {},
	}, {
		/**
		 *
		 */
		teardown: async () => {
			const { unregisterBridgeOutbound } = await import('../../src/chat/bridge/outbound.mjs')
			unregisterBridgeOutbound(username, groupId)
		},
	})
	registerBridgeOutbound(username, groupId, async ({ messageLine }) => {
		outboundLines.push(messageLine)
	})

	assert(resolveBridgeOperations(username, { platform: 'mock', botname: 'clear-bot' }))
	await unregisterBridgeOperations(username, 'mock', 'clear-bot')
	assertEquals(resolveBridgeOperations(username, { platform: 'mock', botname: 'clear-bot' }), undefined)

	await notifyBridgeOutbound(username, groupId, 'default', { eventId: 'e1', content: { text: 'x' } })
	assertEquals(outboundLines.length, 0)

	assertThrows(
		() => requireBridgeOperation(username, { platform: 'mock', botname: 'clear-bot' }, 'sendTyping'),
		Error,
		'bridge op not registered',
	)
})

Deno.test('group.bridgeBot().stop() invokes stopSelf op', async () => {
	const username = `bridge-lifecycle-stop-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_lifecycle_stop_',
		minP2pNode: true,
	})
	await ensureServer()

	const { registerBridgeOperations } = await import('../../src/chat/bridge/operations.mjs')
	const { appendSignedLocalEvent } = await import('../../src/chat/dag/append.mjs')
	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { getChatClient } = await import('../../src/api/index.mjs')

	let stopSelfCalled = false
	registerBridgeOperations(username, 'mock', 'self-stop-bot', {
		/**
		 *
		 */
		stopSelf: async () => { stopSelfCalled = true },
	})

	const groupId = await newGroup(username, { name: 'self-stop' })
	await appendSignedLocalEvent(username, groupId, {
		type: 'group_settings_update',
		timestamp: Date.now(),
		content: {
			bridge: {
				platform: 'mock',
				platformChatId: '900',
				chatKind: 'group',
				botname: 'self-stop-bot',
			},
		},
	})

	const client = await getChatClient(username)
	const group = await client.group(groupId)
	const bridgeBot = group.bridgeBot()
	assert(bridgeBot)
	assertEquals(bridgeBot.platform, 'mock')
	assertEquals(bridgeBot.botname, 'self-stop-bot')
	await bridgeBot.stop()
	assert(stopSelfCalled)
})

Deno.test('client.bridgeBots() lists running per-bot instances', async () => {
	const username = `bridge-lifecycle-list-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_lifecycle_list_',
		minP2pNode: true,
	})
	await ensureServer()

	const { registerBridgeOperations } = await import('../../src/chat/bridge/operations.mjs')
	const { getChatClient } = await import('../../src/api/index.mjs')

	registerBridgeOperations(username, 'telegram', 'list-a', { /**
	 *
	 */
		sendTyping: async () => {} })
	registerBridgeOperations(username, 'discord', 'list-b', { /**
	 *
	 */
		sendTyping: async () => {} })

	const client = await getChatClient(username)
	const bots = await client.bridgeBots()
	assertEquals(bots.length, 2)
	const keys = bots.map(bot => `${bot.platform}:${bot.botname}`).sort()
	assertEquals(keys, ['discord:list-b', 'telegram:list-a'])
})

Deno.test('ensureBridgeGroup records botname in group settings', async () => {
	const username = `bridge-lifecycle-botname-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_lifecycle_botname_',
		minP2pNode: true,
	})
	await ensureServer()

	const { ensureBridgeGroup } = await import('../../src/chat/bridge/registry.mjs')
	const { getState } = await import('../../src/chat/dag/materialize.mjs')

	const { groupId } = await ensureBridgeGroup(username, {
		platform: 'telegram',
		platformChatId: 555001,
		botname: 'record-bot',
	})
	const { state } = await getState(username, groupId)
	assertEquals(state.groupSettings?.bridge?.botname, 'record-bot')

	await ensureBridgeGroup(username, {
		platform: 'telegram',
		platformChatId: 555001,
		botname: 'new-bot',
	})
	const { state: state2 } = await getState(username, groupId)
	assertEquals(state2.groupSettings?.bridge?.botname, 'new-bot')
})

Deno.test('bridge group members() uses listMembers op', async () => {
	const username = `bridge-lifecycle-members-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_lifecycle_members_',
		minP2pNode: true,
	})
	await ensureServer()

	const { registerBridgeOperations } = await import('../../src/chat/bridge/operations.mjs')
	const { bridgeEntityHash } = await import('../../src/chat/bridge/identity.mjs')
	const { appendSignedLocalEvent } = await import('../../src/chat/dag/append.mjs')
	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { getChatClient } = await import('../../src/api/index.mjs')

	const platformUserId = 4242
	const expectedHash = bridgeEntityHash('mock', platformUserId)
	registerBridgeOperations(username, 'mock', 'members-bot', {
		/**
		 * @returns {Promise<object[]>} 成员列表
		 */
		listMembers: async () => [{ platformUserId, displayName: 'Alice' }],
	})

	const groupId = await newGroup(username, { name: 'members-bridge' })
	await appendSignedLocalEvent(username, groupId, {
		type: 'group_settings_update',
		timestamp: Date.now(),
		content: {
			bridge: {
				platform: 'mock',
				platformChatId: '777',
				chatKind: 'group',
				botname: 'members-bot',
			},
		},
	})

	const client = await getChatClient(username)
	const group = await client.group(groupId)
	const { members } = await group.members()
	assertEquals(members.length, 1)
	assertEquals(members[0].entityHash, expectedHash)
	assertEquals(members[0].displayName, 'Alice')
})
