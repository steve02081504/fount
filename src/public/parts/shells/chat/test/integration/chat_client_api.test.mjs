/**
 * ChatClient 对象模型集成测试。
 */
/* global Deno */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals, assertRejects, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createIntegrationBoot } from '../harness.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const CHAR_FIXTURE = 'on_message_yes'

/**
 * @param {string} dataDir 数据根
 * @param {string} username 用户
 * @returns {Promise<void>}
 */
async function seedCharFixture(dataDir, username) {
	const userRoot = join(dataDir, 'users', username)
	const from = join(fixturesRoot, 'chars', CHAR_FIXTURE)
	const to = join(userRoot, 'chars', CHAR_FIXTURE)
	await mkdir(dirname(to), { recursive: true })
	await cp(from, to, { recursive: true })
}

Deno.test('agent ChatClient channel.send attributes char in view-log', async () => {
	const username = `cc-send-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_chat_client_send_',
		minP2pNode: true,
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/server/p2p_server/operator_identity.mjs')
			await ensureOperatorPubKey(user)
			await seedCharFixture(dataDir, user)
		},
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/crud.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { agentEntityHash } = await import('../../src/chat/lib/entity.mjs')
	const { getNodeHash } = await import('npm:@steve02081504/fount-p2p/node/identity')
	const { getChatClient } = await import('../../src/api/index.mjs')
	const { readViewerChannelMessages } = await import('../../src/chat/session/materializeViewerLog.mjs')

	const groupId = await newGroup(username, { name: 'client-send' })
	const channelId = await getDefaultChannelId(username, groupId)
	await addchar(groupId, CHAR_FIXTURE, username)

	const agentHash = agentEntityHash(getNodeHash(), `chars/${CHAR_FIXTURE}`)
	const client = await getChatClient(username, agentHash)
	const group = await client.group(groupId)
	const channel = await group.channel(channelId)
	const sent = await channel.send('hello from ChatClient')
	assert(sent.eventId)

	const { messages } = await readViewerChannelMessages(username, groupId, channelId, { limit: 20 }, {
		kind: 'char',
		charname: CHAR_FIXTURE,
		entityHash: agentHash,
	})
	const row = messages.find(message => message.eventId === sent.eventId)
	assert(row)
	assertEquals(row.charId, CHAR_FIXTURE)
})

Deno.test('agent ChatClient react/pin require permissions', async () => {
	const username = `cc-pin-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_chat_client_pin_',
		minP2pNode: true,
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/server/p2p_server/operator_identity.mjs')
			await ensureOperatorPubKey(user)
			await seedCharFixture(dataDir, user)
		},
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/crud.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { appendSignedLocalEvent } = await import('../../src/chat/dag/append.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
	const { agentEntityHash } = await import('../../src/chat/lib/entity.mjs')
	const { getNodeHash } = await import('npm:@steve02081504/fount-p2p/node/identity')
	const { getState } = await import('../../src/chat/dag/materialize.mjs')
	const { getChatClient } = await import('../../src/api/index.mjs')

	const groupId = await newGroup(username, { name: 'client-pin' })
	const channelId = await getDefaultChannelId(username, groupId)
	await addchar(groupId, CHAR_FIXTURE, username)
	const agentHash = agentEntityHash(getNodeHash(), `chars/${CHAR_FIXTURE}`)

	const posted = await postChannelMessage(username, groupId, channelId, { text: 'pin me' })
	const eventId = posted.event.id

	const client = await getChatClient(username, agentHash)
	const group = await client.group(groupId)
	const channel = await group.channel(channelId)
	const messages = await channel.messages({ limit: 10 })
	const target = messages.find(message => message.eventId === eventId)
	assert(target)

	await assertRejects(() => target.pin(), Error, 'PIN_MESSAGES')

	const { state } = await getState(username, groupId)
	const agentKey = Object.keys(state.members).find(key => state.members[key]?.charname === CHAR_FIXTURE)
	await appendSignedLocalEvent(username, groupId, {
		type: 'role_assign',
		timestamp: Date.now(),
		content: { targetMemberKey: agentKey, roleId: 'founder' },
	})

	await target.pin()
	await target.react(':test_emoji:')
})

Deno.test('agent createGroup throws by design', async () => {
	const username = `cc-nogroup-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_chat_client_nogroup_',
		minP2pNode: true,
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/server/p2p_server/operator_identity.mjs')
			await ensureOperatorPubKey(user)
			await seedCharFixture(dataDir, user)
		},
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/crud.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { agentEntityHash } = await import('../../src/chat/lib/entity.mjs')
	const { getNodeHash } = await import('npm:@steve02081504/fount-p2p/node/identity')
	const { getChatClient } = await import('../../src/api/index.mjs')

	const groupId = await newGroup(username, { name: 'noop' })
	await addchar(groupId, CHAR_FIXTURE, username)
	const client = await getChatClient(username, agentEntityHash(getNodeHash(), `chars/${CHAR_FIXTURE}`))
	await assertRejects(() => client.createGroup({ name: 'nope' }), Error, 'agent actors cannot create groups')
})

Deno.test('bridgeOps mock: typing and leave dispatch', async () => {
	const username = `cc-bridge-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_chat_client_bridge_',
		minP2pNode: true,
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/crud.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { appendSignedLocalEvent } = await import('../../src/chat/dag/append.mjs')
	const { registerBridgeOps } = await import('../../src/chat/bridge/ops.mjs')
	const { getChatClient } = await import('../../src/api/index.mjs')

	const calls = []
	registerBridgeOps(username, 'mock', 'bridge-bot', {
		sendTyping: async payload => { calls.push(['typing', payload]) },
		leaveChat: async payload => { calls.push(['leave', payload]) },
	})

	const groupId = await newGroup(username, { name: 'bridge-mock' })
	const channelId = await getDefaultChannelId(username, groupId)
	await appendSignedLocalEvent(username, groupId, {
		type: 'group_settings_update',
		timestamp: Date.now(),
		content: { bridge: { platform: 'mock', platformChatId: 'plat-chat-1', chatKind: 'group', botname: 'bridge-bot' } },
	})

	const client = await getChatClient(username)
	const group = await client.group(groupId)
	const channel = await group.channel(channelId)
	await channel.typing()
	assertEquals(calls[0][0], 'typing')

	await group.leave()
	assertEquals(calls.some(call => call[0] === 'leave'), true)
})

Deno.test('unregistered bridge op throws', async () => {
	const username = `cc-unreg-${crypto.randomUUID().slice(0, 8)}`
	const { requireBridgeOp } = await import('../../src/chat/bridge/ops.mjs')
	assertThrows(
		() => requireBridgeOp(username, { platform: 'missing', botname: 'nope' }, 'sendTyping'),
		Error,
		'bridge op not registered',
	)
})

Deno.test('fount_chat code_execution context exposes chat objects', async () => {
	const username = `cc-code-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_chat_client_code_',
		minP2pNode: true,
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/server/p2p_server/operator_identity.mjs')
			await ensureOperatorPubKey(user)
			await seedCharFixture(dataDir, user)
		},
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/crud.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
	const { getChatRequest } = await import('../../src/chat/session/chatRequest.mjs')
	const { FOUNT_CHAT_CODE_CONTEXT_PLUGIN } = await import('../../src/chat/lib/codeContextPlugin.mjs')
	const { agentEntityHash } = await import('../../src/chat/lib/entity.mjs')
	const { getNodeHash } = await import('npm:@steve02081504/fount-p2p/node/identity')

	const groupId = await newGroup(username, { name: 'code-ctx' })
	const channelId = await getDefaultChannelId(username, groupId)
	await addchar(groupId, CHAR_FIXTURE, username)
	await postChannelMessage(username, groupId, channelId, { text: 'trigger ctx' })

	const request = await getChatRequest(groupId, CHAR_FIXTURE, channelId, { replicaUsername: username })
	const ctx = await FOUNT_CHAT_CODE_CONTEXT_PLUGIN.interfaces.code_execution.GetJSCodeContext(request)
	assert(ctx.fount?.chat)
	assert(ctx.fount?.group)
	assert(ctx.fount?.channel)
	assertEquals(ctx.fount.chat.entityHash, agentEntityHash(getNodeHash(), `chars/${CHAR_FIXTURE}`).toLowerCase())
})
