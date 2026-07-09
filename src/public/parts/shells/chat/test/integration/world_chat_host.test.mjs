/**
 * M8：WorldChatHost postSystemMessage / localData / triggerCharReply 写路径。
 */
/* global Deno */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createIntegrationBoot } from '../harness.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const REPLICATED_WORLD = 'replicated_world'
const CHAR = 'write_path_agent'
const HOOK_KEY = '__fount_replicated_world_hook_state__'

/**
 * @param {string} dataDir 数据根
 * @param {string} username 用户
 * @returns {Promise<void>}
 */
async function seedHostFixtures(dataDir, username) {
	const userRoot = join(dataDir, 'users', username)
	for (const [kind, name] of [
		['worlds', REPLICATED_WORLD],
		['chars', CHAR],
	]) {
		const from = join(fixturesRoot, kind, name)
		const to = join(userRoot, kind, name)
		await mkdir(dirname(to), { recursive: true })
		await cp(from, to, { recursive: true })
	}
}

Deno.test('WorldChatHost postSystemMessage localData triggerCharReply', async () => {
	globalThis[HOOK_KEY] = { hostConnected: 0, promptCalls: 0, host: null, lastFoldIgnored: 0 }
	const username = `wch-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_world_chat_host_',
		minP2pNode: true,
		/**
		 * 种子 fixture 前确保 operator 公钥就绪。
		 * @param {string} user replica 登录名
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/server/p2p_server/operator_identity.mjs')
			await ensureOperatorPubKey(user)
			await seedHostFixtures(dataDir, user)
		},
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/crud.mjs')
	const { setWorld, addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { resolveWorld } = await import('../../src/chat/session/resolvePart.mjs')
	const { resetWorldHostConnectedCacheForTests } = await import('../../src/chat/session/worldHost.mjs')
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')

	resetWorldHostConnectedCacheForTests()
	const groupId = await newGroup(username, { name: 'world-chat-host' })
	const channelId = await getDefaultChannelId(username, groupId)
	await setWorld(groupId, channelId, REPLICATED_WORLD, username)
	await addchar(groupId, CHAR, username)
	await resolveWorld(groupId, channelId, username)

	const host = globalThis[HOOK_KEY].host
	assert(host, 'ChatHostConnected wired host')

	await host.localData.set('inventory', { gold: 42 })
	assertEquals(await host.localData.get('inventory'), { gold: 42 })

	await host.postSystemMessage(channelId, { type: 'text', content: 'world-host-system-msg' })
	const afterSystem = await readChannelMessagesForUser(username, groupId, channelId, { limit: 20 })
	assert(afterSystem.some(row => String(row.content?.content || '').includes('world-host-system-msg')))

	await host.triggerCharReply(channelId, CHAR)
	const start = Date.now()
	let messages = []
	while (Date.now() - start < 10000) {
		messages = await readChannelMessagesForUser(username, groupId, channelId, { limit: 30 })
		if (messages.some(row => String(row.content?.content || '').includes('write_path_agent reply')))
			break
		await new Promise(resolve => setTimeout(resolve, 40))
	}
	assert(messages.some(row => String(row.content?.content || '').includes('write_path_agent reply')))
})
