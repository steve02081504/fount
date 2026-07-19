/**
 * 触发管线专项（token bucket + backfill 不触发）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { onMessageProbe } from '../fixtures/probes/onMessageProbe.mjs'
import { createCharBoot } from '../harness.mjs'

const CHAR_YES = 'on_message_yes'

Deno.test('token bucket suppresses generation not OnMessage when exhausted', async () => {
	const username = `tb-${crypto.randomUUID().slice(0, 8)}`
	const probe = onMessageProbe
	probe.reset()
	const { ensureServer } = createCharBoot({ username, chars: CHAR_YES })
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
	const probe = onMessageProbe
	probe.reset()
	const { ensureServer } = createCharBoot({ username, chars: CHAR_YES })
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
		content: { type: 'text', content: 'backfill message' },
		hlc: { wall: Date.now() },
	}, { ingress: 'backfill' })

	await new Promise(resolve => setTimeout(resolve, 200))
	assertEquals(probe.events.length, 0)
})
