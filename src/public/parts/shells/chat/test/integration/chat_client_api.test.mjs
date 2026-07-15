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
 * @returns {Promise<void>} 无
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
		/**
		 *
		 * @param {string} user 用户名
 * @returns {Promise<void>} 无
		 */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			await seedCharFixture(dataDir, user)
		},
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { ensureLocalAgentEntityHash } = await import('../../src/entity/member.mjs')
	const { getChatClient } = await import('../../src/api/client.mjs')
	const { readViewerChannelMessages } = await import('../../src/chat/session/materializeViewerLog.mjs')

	const groupId = await newGroup(username, { name: 'client-send' })
	const channelId = await getDefaultChannelId(username, groupId)
	await addchar(groupId, CHAR_FIXTURE, username)

	const agentHash = await ensureLocalAgentEntityHash(username, CHAR_FIXTURE)
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
		/**
		 *
		 * @param {string} user 用户名
 * @returns {Promise<void>} 无
		 */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			await seedCharFixture(dataDir, user)
		},
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { appendSignedLocalEvent } = await import('../../src/chat/dag/append.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
	const { ensureLocalAgentEntityHash } = await import('../../src/entity/member.mjs')
	const { getState } = await import('../../src/chat/dag/materialize.mjs')
	const { getChatClient } = await import('../../src/api/client.mjs')

	const groupId = await newGroup(username, { name: 'client-pin' })
	const channelId = await getDefaultChannelId(username, groupId)
	await addchar(groupId, CHAR_FIXTURE, username)
	const agentHash = await ensureLocalAgentEntityHash(username, CHAR_FIXTURE)

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

Deno.test('agent createGroup is allowed', async () => {
	const username = `cc-agroup-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_chat_client_agroup_',
		minP2pNode: true,
		/**
		 *
		 * @param {string} user 用户名
 * @returns {Promise<void>} 无
		 */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			await seedCharFixture(dataDir, user)
		},
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { ensureLocalAgentEntityHash } = await import('../../src/entity/member.mjs')
	const { getChatClient } = await import('../../src/api/client.mjs')

	const groupId = await newGroup(username, { name: 'noop' })
	await addchar(groupId, CHAR_FIXTURE, username)
	const agentHash = await ensureLocalAgentEntityHash(username, CHAR_FIXTURE)
	const client = await getChatClient(username, agentHash)
	const created = await client.createGroup({ name: 'agent-owned' })
	assert(created.id)
	const { getState } = await import('../../src/chat/dag/materialize.mjs')
	const { state } = await getState(username, created.id)
	const ownerRow = Object.values(state.members).find(m => (m.roles || []).includes('founder'))
	assertEquals(String(ownerRow?.entityHash || '').toLowerCase(), agentHash.toLowerCase())
})

Deno.test('bridgeOperations mock: typing and leave dispatch', async () => {
	const username = `cc-bridge-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_chat_client_bridge_',
		minP2pNode: true,
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { appendSignedLocalEvent } = await import('../../src/chat/dag/append.mjs')
	const { registerBridgeOperations } = await import('../../src/chat/bridge/operations.mjs')
	const { getChatClient } = await import('../../src/api/client.mjs')

	const calls = []
	registerBridgeOperations(username, 'mock', 'bridge-bot', {
		/**
		 *
		 * @param {object} payload 载荷
 * @returns {Promise<void>} 无
		 */
		sendTyping: async payload => { calls.push(['typing', payload]) },
		/**
		 *
		 * @param {object} payload 载荷
 * @returns {Promise<void>} 无
		 */
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
	const { requireBridgeOperation } = await import('../../src/chat/bridge/operations.mjs')
	assertThrows(
		() => requireBridgeOperation(username, { platform: 'missing', botname: 'nope' }, 'sendTyping'),
		Error,
		'bridge op not registered',
	)
})

Deno.test('ChatClient session/profile/denylist/send-with-files/fork surface', async () => {
	const username = `cc-e3-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_chat_client_e3_',
		minP2pNode: true,
		/**
		 *
		 * @param {string} user 用户名
 * @returns {Promise<void>} 无
		 */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			await seedCharFixture(dataDir, user)
		},
	})
	await ensureServer()

	const { getChatClient } = await import('../../src/api/client.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { Buffer } = await import('node:buffer')

	const client = await getChatClient(username)
	assert(await client.reputation())
	assert(await client.nodeDenylist.list())

	await client.updateProfile({ localized: { 'zh-CN': { name: 'e3-profile' } } })

	const group = await client.createGroup({ name: 'e3-session' })
	const channelId = await getDefaultChannelId(username, group.id)
	await group.session.addChar(CHAR_FIXTURE, { deferGreeting: true })
	await group.session.setCharReplyFrequency(CHAR_FIXTURE, 0)
	await group.session.setPersona(null)

	const channel = await group.channel(channelId)
	const withFile = await channel.send({
		text: 'with attachment',
		files: [{ name: 'note.txt', mime_type: 'text/plain', buffer: Buffer.from('hello-e3') }],
	})
	assert(withFile.eventId)
	assert((withFile.content?.fileIds || []).length >= 1, 'send with files should attach fileIds')

	const forked = await group.fork({ name: 'e3-fork' })
	assert(forked.id)
	assert(forked.id !== group.id)

	await group.federation.catchup({ waitMs: 50 })
})

Deno.test('fount_chat code_execution context exposes chat objects', async () => {
	const username = `cc-code-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_chat_client_code_',
		minP2pNode: true,
		/**
		 *
		 * @param {string} user 用户名
 * @returns {Promise<void>} 无
		 */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			await seedCharFixture(dataDir, user)
		},
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
	const { getChatRequest } = await import('../../src/chat/session/chatRequest.mjs')
	const { FOUNT_CHAT_CODE_CONTEXT_PLUGIN } = await import('../../src/chat/lib/codeContextPlugin.mjs')
	const { ensureLocalAgentEntityHash } = await import('../../src/entity/member.mjs')

	const groupId = await newGroup(username, { name: 'code-ctx' })
	const channelId = await getDefaultChannelId(username, groupId)
	await addchar(groupId, CHAR_FIXTURE, username)
	await postChannelMessage(username, groupId, channelId, { text: 'trigger ctx' })

	const agentHash = await ensureLocalAgentEntityHash(username, CHAR_FIXTURE)
	const request = await getChatRequest(groupId, CHAR_FIXTURE, channelId, { replicaUsername: username })
	const ctx = await FOUNT_CHAT_CODE_CONTEXT_PLUGIN.interfaces.code_execution.GetJSCodeContext(request)
	assert(ctx.fount?.chat)
	assert(ctx.fount?.group)
	assert(ctx.fount?.channel)
	assertEquals(ctx.fount.chat.entityHash, agentHash.toLowerCase())
})

Deno.test('agent ChatClient leave/fork/createInvite use agent entity', async () => {
	const username = `cc-agent-life-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_chat_client_agent_life_',
		minP2pNode: true,
		/**
		 *
		 * @param {string} user 用户名
 * @returns {Promise<void>} 无
		 */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			await seedCharFixture(dataDir, user)
		},
	})
	await ensureServer()

	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { ensureLocalAgentEntityHash } = await import('../../src/entity/member.mjs')
	const { getChatClient } = await import('../../src/api/client.mjs')
	const { getState } = await import('../../src/chat/dag/materialize.mjs')
	const { resolveOperatorEntityHashForUser } = await import('../../src/entity/identity.mjs')
	const { peekLocalSignerPubKeyHash } = await import('../../src/chat/dag/localSigner.mjs')

	const agentHash = await ensureLocalAgentEntityHash(username, CHAR_FIXTURE)
	const client = await getChatClient(username, agentHash)
	const created = await client.createGroup({ name: 'agent-life' })
	await addchar(created.id, CHAR_FIXTURE, username)
	const agentGroup = await client.group(created.id)

	const invite = await agentGroup.createInvite()
	assert(typeof invite === 'string' && invite.length > 0)
	const agentPub = await peekLocalSignerPubKeyHash(username, created.id, agentHash)
	assert(invite.toLowerCase().includes(agentPub))

	const forked = await agentGroup.fork({ name: 'agent-life-fork' })
	assert(forked.id)
	assert(forked.id !== created.id)
	const { state: forkState } = await getState(username, forked.id)
	const forkFounder = Object.values(forkState.members).find(m => (m.roles || []).includes('founder'))
	assertEquals(String(forkFounder?.entityHash || '').toLowerCase(), agentHash.toLowerCase())

	await agentGroup.leave()
	const { listUserGroups } = await import('../../src/chat/lib/userGroups.mjs')
	assertEquals((await listUserGroups(username)).includes(created.id), false)
	const operator = await resolveOperatorEntityHashForUser(username)
	assert(operator)
	assert(operator !== agentHash)
})

Deno.test('agent ChatClient may edit/delete owned human messages after setEntityOwner', async () => {
	const username = `cc-master-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_chat_client_master_',
		minP2pNode: true,
		/**
		 * @param {string} user 用户名
		 * @returns {Promise<void>} 无
		 */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			await seedCharFixture(dataDir, user)
		},
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { ensureLocalAgentEntityHash } = await import('../../src/entity/member.mjs')
	const { getChatClient } = await import('../../src/api/client.mjs')
	const {
		setEntityOwner,
		resolveOperatorEntityHashForUser,
		loadEntityIdentity,
	} = await import('../../src/entity/identity.mjs')
	const { getState } = await import('../../src/chat/dag/materialize.mjs')
	const { peekLocalSignerPubKeyHash } = await import('../../src/chat/dag/localSigner.mjs')

	const groupId = await newGroup(username, { name: 'human-owned-by-agent' })
	const channelId = await getDefaultChannelId(username, groupId)
	await addchar(groupId, CHAR_FIXTURE, username)

	const agentHash = (await ensureLocalAgentEntityHash(username, CHAR_FIXTURE)).toLowerCase()
	const operator = (await resolveOperatorEntityHashForUser(username)).toLowerCase()
	await setEntityOwner(username, operator, agentHash)
	assertEquals((await loadEntityIdentity(username, operator)).ownerEntityHash, agentHash)

	const operatorPub = await peekLocalSignerPubKeyHash(username, groupId, operator)
	const { state: afterOwner } = await getState(username, groupId)
	assertEquals(String(afterOwner.members[operatorPub]?.ownerEntityHash || '').toLowerCase(), agentHash)

	const humanClient = await getChatClient(username)
	const humanMsg = await (await (await humanClient.group(groupId)).channel(channelId)).send('owned by master')
	assert(humanMsg.eventId)

	const masterClient = await getChatClient(username, agentHash)
	const channel = await (await masterClient.group(groupId)).channel(channelId)
	const rows = await channel.messages({ limit: 20 })
	const owned = rows.find(row => row.eventId === humanMsg.eventId)
	assert(owned, 'master must see owned human message in channel history')
	const edited = await owned.edit({ text: 'master edited human' })
	assertEquals(edited.type, 'message_edit')
	assertEquals(edited.content.targetId, humanMsg.eventId)

	const deleted = await owned.delete()
	assertEquals(deleted.type, 'message_delete')
	assertEquals(deleted.content.targetId, humanMsg.eventId)

	await setEntityOwner(username, operator, null)
})
