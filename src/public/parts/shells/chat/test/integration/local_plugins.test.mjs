/**
 * 本机插件名单 + world GetChatPlugins 在 getChatRequest 中 merge。
 */
/* global Deno */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { localWorldHookState } from '../fixtures/probes/localWorldHookState.mjs'
import { createIntegrationBoot } from '../harness.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const LOCAL_WORLD = 'local_world'
const CHAR = 'write_path_agent'

/**
 * @param {string} dataDir 数据根
 * @param {string} username 用户
 * @returns {Promise<void>}
 */
async function seedFixtures(dataDir, username) {
	const userRoot = join(dataDir, 'users', username)
	for (const [kind, name] of [
		['worlds', LOCAL_WORLD],
		['chars', CHAR],
	]) {
		const from = join(fixturesRoot, kind, name)
		const to = join(userRoot, kind, name)
		await mkdir(dirname(to), { recursive: true })
		await cp(from, to, { recursive: true })
	}
}

Deno.test('local plugins + world GetChatPlugins merge into getChatRequest', async () => {
	localWorldHookState.reset()
	const username = `lp-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		minP2pNode: true,
		/**
		 * @param {string} user replica
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			await seedFixtures(dataDir, user)
		},
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { addplugin, removeplugin, getPluginListOfGroup, bindWorld, addchar } =
		await import('../../src/chat/session/partConfig.mjs')
	const { getLocalPluginNames } = await import('../../src/chat/session/localPlugins.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { getChatRequest } = await import('../../src/chat/session/chatRequest.mjs')
	const { getMaterializedSession } = await import('../../src/chat/session/dagSession.mjs')

	const groupId = await newGroup(username, { name: 'local-plugins' })
	const defaults = await getLocalPluginNames(username, groupId)
	assertEquals(await getPluginListOfGroup(groupId, username), defaults)

	await addplugin(groupId, 'probe-plugin', username)
	assert( (await getLocalPluginNames(username, groupId)).includes('probe-plugin'))
	await removeplugin(groupId, 'probe-plugin', username)
	assert(!(await getLocalPluginNames(username, groupId)).includes('probe-plugin'))

	const session = await getMaterializedSession(username, groupId)
	assertEquals(session.plugins, undefined)

	const channelId = await getDefaultChannelId(username, groupId)
	await bindWorld(groupId, channelId, LOCAL_WORLD, username)
	await addchar(groupId, CHAR, username)

	const req = await getChatRequest(groupId, CHAR, channelId, { replicaUsername: username })
	assert(localWorldHookState.chatPluginsCalls >= 1)
	assert(req.plugins['world-injected'], 'world GetChatPlugins 注入')
	assert(req.plugins.fount_chat, '内建 fount_chat')
})
