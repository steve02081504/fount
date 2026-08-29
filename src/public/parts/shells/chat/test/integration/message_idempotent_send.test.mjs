/**
 * 发送幂等：同 `extension.chat.clientMessageId` 重复 postChannelMessage 只落一条 DAG 消息，
 * 返回既有事件（客户端重试 / 离线队列重发不再产生重复消息）。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { createIntegrationBoot } from '../harness.mjs'

Deno.test('postChannelMessage dedups by clientMessageId', async () => {
	const username = `idem-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({ username, minP2pNode: true })
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')

	const groupId = await newGroup(username, { name: 'idem-test' })
	const channelId = await getDefaultChannelId(username, groupId)
	const clientMessageId = `uid-${crypto.randomUUID().slice(0, 8)}`
	const rawContent = { content: 'dup', extension: { chat: { clientMessageId } } }

	const first = await postChannelMessage(username, groupId, channelId, { rawContent })
	const second = await postChannelMessage(username, groupId, channelId, { rawContent })

	assertEquals(first.event.id, second.event.id, 'duplicate send must return the existing event')

	const rows = await readChannelMessagesForUser(username, groupId, channelId, { limit: 50 })
	const matches = rows.filter(row =>
		row.type === 'message'
		&& String(row.content?.extension?.chat?.clientMessageId ?? '') === clientMessageId)
	assertEquals(matches.length, 1, 'only one message must be persisted')
	assertEquals(String(matches[0].eventId), String(first.event.id))
})
