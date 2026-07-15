/**
 * 私有状态 per-entity：operator HTTP / ChatClient 与 agent ChatClient 同构隔离；半 acting 参数闭合。
 */
/* global Deno */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createIntegrationBoot } from '../harness.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const CHAR = 'on_message_yes'

Deno.test('agent bookmarks isolated from operator ChatClient', async () => {
	const username = `eps-bm-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		minP2pNode: true,
		/**
		 *
		 * @param {string} user 用户名
 * @returns {Promise<void>} 无
		 */
		afterInit: async user => {
			const from = join(fixturesRoot, 'chars', CHAR)
			const to = join(dataDir, 'users', user, 'chars', CHAR)
			await mkdir(dirname(to), { recursive: true })
			await cp(from, to, { recursive: true })
		},
	})
	await ensureServer()

	const { ensureLocalAgentEntityHash } = await import('../../src/entity/member.mjs')
	const { getChatClient } = await import('../../src/api/client.mjs')
	const agentHash = await ensureLocalAgentEntityHash(username, CHAR)
	const operatorClient = await getChatClient(username)
	const agentClient = await getChatClient(username, agentHash)

	await agentClient.bookmarks.set([{ groupId: 'agent-only', pinnedAt: Date.now() }])
	await operatorClient.bookmarks.set([{ groupId: 'operator-only', pinnedAt: Date.now() }])

	const agentList = await agentClient.bookmarks.list()
	const operatorList = await operatorClient.bookmarks.list()
	assertEquals(agentList.entries.map(row => row.groupId), ['agent-only'])
	assertEquals(operatorList.entries.map(row => row.groupId), ['operator-only'])
})

Deno.test('agent notification preferences and read markers isolated from operator', async () => {
	const username = `eps-np-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		minP2pNode: true,
		/**
		 *
		 * @param {string} user 用户名
 * @returns {Promise<void>} 无
		 */
		afterInit: async user => {
			const from = join(fixturesRoot, 'chars', CHAR)
			const to = join(dataDir, 'users', user, 'chars', CHAR)
			await mkdir(dirname(to), { recursive: true })
			await cp(from, to, { recursive: true })
		},
	})
	await ensureServer()

	const { ensureLocalAgentEntityHash } = await import('../../src/entity/member.mjs')
	const { getChatClient } = await import('../../src/api/client.mjs')
	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')

	const agentHash = await ensureLocalAgentEntityHash(username, CHAR)
	const operatorClient = await getChatClient(username)
	const agentClient = await getChatClient(username, agentHash)
	const groupId = await newGroup(username, { name: 'eps-unread' })
	const channelId = await getDefaultChannelId(username, groupId)
	await postChannelMessage(username, groupId, channelId, { text: 'hi' })

	await agentClient.notifications.set({ [groupId]: { mode: 'all' } })
	await operatorClient.notifications.set({ [groupId]: { mode: 'nothing' } })
	assertEquals((await agentClient.notifications.get())[groupId].mode, 'all')
	assertEquals((await operatorClient.notifications.get())[groupId].mode, 'nothing')

	const agentChannel = await (await agentClient.group(groupId)).channel(channelId)
	await agentChannel.markRead({ eventId: 'aa'.repeat(32), seq: 1 })
	assertEquals((await agentChannel.readMarker())?.seq, 1)
	assertEquals(await (await (await operatorClient.group(groupId)).channel(channelId)).readMarker(), null)
})

Deno.test('care and inbox namespaces stay bound to client entityHash', async () => {
	const username = `eps-care-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		minP2pNode: true,
		/**
		 *
		 * @param {string} user 用户名
 * @returns {Promise<void>} 无
		 */
		afterInit: async user => {
			const from = join(fixturesRoot, 'chars', CHAR)
			const to = join(dataDir, 'users', user, 'chars', CHAR)
			await mkdir(dirname(to), { recursive: true })
			await cp(from, to, { recursive: true })
		},
	})
	await ensureServer()

	const { ensureLocalAgentEntityHash } = await import('../../src/entity/member.mjs')
	const { getChatClient } = await import('../../src/api/client.mjs')
	const { listCared } = await import('../../src/chat/lib/care.mjs')
	const { appendChatInbox } = await import('../../src/chat/lib/inbox.mjs')
	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const agentHash = (await ensureLocalAgentEntityHash(username, CHAR)).toLowerCase()
	const operatorClient = await getChatClient(username)
	const agentClient = await getChatClient(username, agentHash)
	const target = 'c'.repeat(128)
	const groupId = await newGroup(username, { name: 'eps-inbox' })

	await agentClient.care.set(target, true)
	assertEquals(await agentClient.care.list(), [target])
	assertEquals(await operatorClient.care.list(), [])
	assertEquals(await listCared(username, agentHash), [target])
	assertEquals(await listCared(username, operatorClient.entityHash), [])

	await appendChatInbox(username, agentHash, {
		kind: 'mention',
		at: Date.now(),
		groupId,
		channelId: 'default',
		eventId: 'aa'.repeat(32),
		preview: 'agent inbox only',
	})
	assertEquals((await agentClient.inbox.list({ limit: 10 })).items.length, 1)
	assertEquals((await operatorClient.inbox.list({ limit: 10 })).items.length, 0)
})
