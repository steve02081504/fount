/**
 * 触发管线专项（token bucket + backfill 不触发）。
 */
/* global Deno */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { onMessageProbeState } from '../fixtures/on_message_probe_state.mjs'
import { createIntegrationBoot } from '../harness.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const CHAR_YES = 'on_message_yes'

/**
 * @param {string} dataDir 数据根
 * @param {string} username 用户
 * @returns {Promise<void>}
 */
async function seedCharFixture(dataDir, username) {
	const userRoot = join(dataDir, 'users', username)
	const from = join(fixturesRoot, 'chars', CHAR_YES)
	const to = join(userRoot, 'chars', CHAR_YES)
	await mkdir(dirname(to), { recursive: true })
	await cp(from, to, { recursive: true })
}

Deno.test('token bucket suppresses generation not OnMessage when exhausted', async () => {
	const username = `tb-${crypto.randomUUID().slice(0, 8)}`
	const probe = onMessageProbeState()
	probe.reset()
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_trigger_bucket_',
		minP2pNode: true,
		/**
	 * @param {string} user fount 用户名
	 * @returns {Promise<void>}
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

	const groupId = await newGroup(username, { name: 'token-bucket' })
	const channelId = await getDefaultChannelId(username, groupId)
	await addchar(groupId, CHAR_YES, username)
	probe.returnValue = true

	await appendSignedLocalEvent(username, groupId, {
		type: 'group_settings_update',
		timestamp: Date.now(),
		content: {
			autoReplyTokenBucketEnabled: true,
			autoReplyTokenBurst: 1,
			autoReplyTokenRefillPerMessage: 0,
		},
	})

	const beforeEvents = probe.events.length
	const beforeReplies = probe.replies
	await postChannelMessage(username, groupId, channelId, { text: 'first' })
	await new Promise(resolve => setTimeout(resolve, 800))
	assertEquals(probe.events.length > beforeEvents, true)
	assertEquals(probe.replies, beforeReplies + 1)
	const afterFirstEvents = probe.events.length
	const afterFirstReplies = probe.replies

	await postChannelMessage(username, groupId, channelId, { text: 'second' })
	await new Promise(resolve => setTimeout(resolve, 800))
	// 事件一律送达 OnMessage；桶耗尽只压回生成意愿
	assertEquals(probe.events.length > afterFirstEvents, true)
	assertEquals(probe.replies, afterFirstReplies)
})

Deno.test('backfill ingress skips trigger pipeline', async () => {
	const username = `bf-${crypto.randomUUID().slice(0, 8)}`
	const probe = onMessageProbeState()
	probe.reset()
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_trigger_backfill_',
		minP2pNode: true,
		/**
	 * @param {string} user fount 用户名
	 * @returns {Promise<void>}
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
	const { dispatchMessageFanout } = await import('../../src/chat/dag/messageFanout.mjs')

	const groupId = await newGroup(username, { name: 'backfill' })
	const channelId = await getDefaultChannelId(username, groupId)
	await addchar(groupId, CHAR_YES, username)
	probe.returnValue = true

	await dispatchMessageFanout(username, groupId, channelId, {
		type: 'message',
		eventId: `${'cc'.repeat(32)}`,
		sender: 'e'.repeat(64),
		content: { type: 'text', content: 'backfill msg' },
		hlc: { wall: Date.now() },
	}, { ingress: 'backfill' })

	await new Promise(resolve => setTimeout(resolve, 200))
	assertEquals(probe.events.length, 0)
})
