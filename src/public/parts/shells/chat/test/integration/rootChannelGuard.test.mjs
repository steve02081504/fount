/**
 * 根容器频道保护与默认频道创建测试。
 * 覆盖：建群/建 DM 默认文字频道正确落盘；根频道硬编码禁止发消息/文件。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assert, assertEquals, assertRejects } from 'jsr:@std/assert'

import { createIntegrationBoot } from '../harness.mjs'

Deno.test('newGroup without defaultChannelId creates root + default text channel', async () => {
	const username = `root-genesis-${crypto.randomUUID().slice(0, 8)}`
	await createIntegrationBoot({ username, minP2pNode: true }).ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { getState } = await import('../../src/chat/dag/materialize.mjs')
	const { ROOT_CHANNEL_ID } = await import('../../src/chat/dag/groupSettings.mjs')

	const { state } = await getState(username, await newGroup(username, { name: 'genesis' }))

	const root = state.channels[ROOT_CHANNEL_ID]
	assert(root, 'root channel must exist')
	assertEquals(root.type, 'category')
	assertEquals(root.name, '')
	// 根 links 不得含空/null（历史上 defaultChannelId 缺失会写入 undefined→null）
	assertEquals(root.links, ['default'])

	const def = state.channels['default']
	assert(def, 'default text channel must exist')
	assertEquals(def.type, 'text')
	assertEquals(def.permissionBlockId, ROOT_CHANNEL_ID)

	assertEquals(state.groupSettings.rootChannelId, ROOT_CHANNEL_ID)
	assertEquals(state.groupSettings.defaultChannelId, 'default')
})

Deno.test('DM default channel is unnamed (empty name)', async () => {
	const username = `root-dm-${crypto.randomUUID().slice(0, 8)}`
	await createIntegrationBoot({ username, minP2pNode: true }).ensureServer()

	const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
	const { randomKeyPair } = await import('npm:@steve02081504/fount-p2p/crypto')
	const { createEcdhDmGroup } = await import('../../src/chat/dm/index.mjs')
	const { getState } = await import('../../src/chat/dag/materialize.mjs')

	const myPub = await ensureOperatorPubKey(username)
	const peerPub = Buffer.from((await randomKeyPair()).publicKey).toString('hex')
	const dm = await createEcdhDmGroup(username, myPub, peerPub)
	const { state } = await getState(username, dm.groupId)
	const def = state.channels[dm.defaultChannelId]
	assert(def, 'DM default channel must exist')
	assertEquals(def.name, '')
})

Deno.test('postChannelMessage to root channel is rejected even for admin', async () => {
	const username = `root-post-${crypto.randomUUID().slice(0, 8)}`
	await createIntegrationBoot({ username, minP2pNode: true }).ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
	const { ROOT_CHANNEL_ID } = await import('../../src/chat/dag/groupSettings.mjs')

	const groupId = await newGroup(username, { name: 'post-guard' })
	await assertRejects(
		() => postChannelMessage(username, groupId, ROOT_CHANNEL_ID, { text: 'nope' }),
		error => error instanceof Error && /root channel/i.test(String(error.message)),
	)
})
