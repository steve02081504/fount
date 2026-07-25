/**
 * per-bot bridgeOperations 生命周期集成测试（虚拟会话）。
 */
/* global Deno */
import { assert, assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createIntegrationBoot } from '../harness.mjs'

Deno.test('per-bot bridgeOperations: two bots on same platform route independently', async () => {
	const username = `bridge-lifecycle-parallel-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		minP2pNode: true,
	})
	await ensureServer()

	const { registerBridgeOperations, requireBridgeOperation } = await import('../../src/chat/bridge/operations.mjs')

	const callsA = []
	const callsB = []
	registerBridgeOperations(username, 'telegram', 'bot-a', {
		/** @returns {Promise<void>} */
		sendTyping: async () => { callsA.push('typing') },
	})
	registerBridgeOperations(username, 'telegram', 'bot-b', {
		/** @returns {Promise<void>} */
		sendTyping: async () => { callsB.push('typing') },
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
		minP2pNode: true,
	})
	await ensureServer()

	const { registerBridgeOperations, unregisterBridgeOperations, requireBridgeOperation, resolveBridgeOperations } =
		await import('../../src/chat/bridge/operations.mjs')
	const { registerBridgeOutbound, notifyBridgeOutbound } = await import('../../src/chat/bridge/outbound.mjs')
	const { ensureVirtualBridgeSession } = await import('../../src/chat/bridge/session.mjs')

	const session = ensureVirtualBridgeSession(username, {
		platform: 'mock',
		platformChatId: 'clear-1',
		botname: 'clear-bot',
	})
	const groupId = session.groupId
	/** @type {object[]} */
	const outboundLines = []
	registerBridgeOperations(username, 'mock', 'clear-bot', {
		/** @returns {Promise<void>} */
		sendTyping: async () => {},
	}, {
		/** @returns {Promise<void>} */
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
		'bridge operation not registered',
	)
})

Deno.test('group.bridgeBot().stop() invokes stopSelf op', async () => {
	const username = `bridge-lifecycle-stop-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		minP2pNode: true,
	})
	await ensureServer()

	const { registerBridgeOperations } = await import('../../src/chat/bridge/operations.mjs')
	const { ensureVirtualBridgeSession } = await import('../../src/chat/bridge/session.mjs')
	const { getChatClient } = await import('../../src/api/client/index.mjs')

	let stopSelfCalled = false
	registerBridgeOperations(username, 'mock', 'self-stop-bot', {
		/** @returns {Promise<void>} */
		stopSelf: async () => { stopSelfCalled = true },
	})

	const session = ensureVirtualBridgeSession(username, {
		platform: 'mock',
		platformChatId: '900',
		botname: 'self-stop-bot',
	})

	const client = await getChatClient(username)
	const group = await client.group(session.groupId)
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
		minP2pNode: true,
	})
	await ensureServer()

	const { registerBridgeOperations } = await import('../../src/chat/bridge/operations.mjs')
	const { getChatClient } = await import('../../src/api/client/index.mjs')

	registerBridgeOperations(username, 'telegram', 'list-a', {
		/** @returns {Promise<void>} */
		sendTyping: async () => {},
	})
	registerBridgeOperations(username, 'discord', 'list-b', {
		/** @returns {Promise<void>} */
		sendTyping: async () => {},
	})

	const client = await getChatClient(username)
	const bots = await client.bridgeBots()
	assertEquals(bots.length, 2)
	const keys = bots.map(bot => `${bot.platform}:${bot.botname}`).sort()
	assertEquals(keys, ['discord:list-b', 'telegram:list-a'])
})

Deno.test('ensureBridgeGroup records botname on virtual session', async () => {
	const username = `bridge-lifecycle-botname-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		minP2pNode: true,
	})
	await ensureServer()

	const { ensureBridgeGroup } = await import('../../src/chat/bridge/registry.mjs')
	const { getVirtualBridgeSession } = await import('../../src/chat/bridge/session.mjs')

	const { groupId } = await ensureBridgeGroup(username, {
		platform: 'telegram',
		platformChatId: 555001,
		botname: 'record-bot',
	})
	assertEquals(getVirtualBridgeSession(username, groupId)?.botname, 'record-bot')

	await ensureBridgeGroup(username, {
		platform: 'telegram',
		platformChatId: 555001,
		botname: 'new-bot',
	})
	assertEquals(getVirtualBridgeSession(username, groupId)?.botname, 'new-bot')
})

Deno.test('bridge group members() uses listMembers op', async () => {
	const username = `bridge-lifecycle-members-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		minP2pNode: true,
	})
	await ensureServer()

	const { registerBridgeOperations } = await import('../../src/chat/bridge/operations.mjs')
	const { bridgeEntityHash } = await import('../../src/chat/bridge/identity.mjs')
	const { ensureVirtualBridgeSession } = await import('../../src/chat/bridge/session.mjs')
	const { getChatClient } = await import('../../src/api/client/index.mjs')

	const platformUserId = 4242
	const expectedHash = bridgeEntityHash('mock', platformUserId)
	registerBridgeOperations(username, 'mock', 'members-bot', {
		/**
		 * @returns {Promise<object[]>} 成员列表
		 */
		listMembers: async () => [{ platformUserId, displayName: 'Alice' }],
	})

	const session = ensureVirtualBridgeSession(username, {
		platform: 'mock',
		platformChatId: '777',
		botname: 'members-bot',
	})

	const client = await getChatClient(username)
	const group = await client.group(session.groupId)
	const { members } = await group.members()
	assertEquals(members.length, 1)
	assertEquals(members[0].entityHash, expectedHash)
	assertEquals(members[0].displayName, 'Alice')
})
