/**
 * 新建频道后不再自动清理“只含问候语”的频道：频道由用户手动管理，问候频道应保留。
 */
/* global Deno */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals } from 'jsr:@std/assert'

import { createIntegrationBoot } from '../harness.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const WORLD = 'write_path_hooks'

/**
 * @param {string} dataDir 数据根
 * @param {string} username 用户
 * @returns {Promise<void>}
 */
async function seedWorldFixture(dataDir, username) {
	const from = join(fixturesRoot, 'worlds', WORLD)
	const to = join(dataDir, 'users', username, 'worlds', WORLD)
	await mkdir(dirname(to), { recursive: true })
	await cp(from, to, { recursive: true })
}

Deno.test('new channel keeps the greeting-only initial channel', async () => {
	const username = `keepgreet-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		minP2pNode: true,
		/**
		 * @param {string} user 新建的测试用户名
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			await seedWorldFixture(dataDir, user)
		},
	})
	await ensureServer()

	const { createGroup } = await import('../../src/chat/dag/lifecycle.mjs')
	const { newMetadata } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { getLocalSignerForNewGroup } = await import('../../src/chat/dag/localSigner.mjs')
	const { createChannel } = await import('../../src/chat/dag/channelOperations.mjs')
	const { getState } = await import('../../src/chat/dag/materialize.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')
	const { scheduleDmChannelAutoName } = await import('../../src/group/routes/channelAutoName.mjs')

	const groupId = crypto.randomUUID()
	const signer = await getLocalSignerForNewGroup(username, groupId)
	await createGroup(username, {
		groupId,
		name: 'keep-greeting',
		ownerPubKeyHash: signer.sender,
		secretKey: signer.secretKey,
		defaultChannelName: '',
		friendBinding: { charname: 'on_message_yes' },
		enableGroupFederation: false,
	})
	await newMetadata(groupId, username)

	const greetingChannelId = await getDefaultChannelId(username, groupId)
	const { bindWorld } = await import('../../src/chat/session/partConfig.mjs')
	await bindWorld(groupId, greetingChannelId, WORLD, username)

	const greetings = await readChannelMessagesForUser(username, groupId, greetingChannelId, { limit: 13 })
	assertEquals(greetings.length, 1, 'greeting channel must contain exactly the world greeting')

	const state0 = (await getState(username, groupId)).state
	const created = await createChannel(username, groupId, {
		type: 'text',
		name: 'second',
		parentChannelId: state0.groupSettings.rootChannelId,
	})
	const newChannelId = created.content.channelId
	await scheduleDmChannelAutoName(username, groupId, newChannelId, (await getState(username, groupId)).state)

	const state1 = (await getState(username, groupId)).state
	assert(state1.channels[greetingChannelId], 'greeting-only channel must be kept')
	assert(state1.channels[newChannelId], 'new channel must exist')

	// 运行时重建（WS 空闲卸载 / 重启）后问候仍应进入 prompt 上下文。
	const { purgeGroupSession } = await import('../../src/chat/session/wsLifecycle.mjs')
	purgeGroupSession(groupId)
	const { getChatRequest } = await import('../../src/chat/session/chatRequest.mjs')
	const request = await getChatRequest(groupId, undefined, newChannelId, { replicaUsername: username })
	assert(
		request.chat_log.some(row => row.role === 'char' && row.content === 'world-greeting:default'),
		'greeting must be rehydrated into the prompt after a runtime reload',
	)
})
