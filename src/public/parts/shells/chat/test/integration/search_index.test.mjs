/**
 * Chat 全文搜索索引与 API。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createTestSession } from '../harness.mjs'

const getSession = createTestSession({ minP2pNode: true })

Deno.test('searchGroupMessages finds posted text and removes on delete', async () => {
	const { username } = await getSession()
	const { newGroup } = await import('../../src/chat/session/crud.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
	const { searchGroupMessages, indexChannelMessageLine } = await import('../../src/chat/search/index.mjs')
	const { appendChannelMessageDelete, findChannelMessageRow } = await import('../../src/chat/channel/messageMutations.mjs')

	const token = `SearchToken${crypto.randomUUID().slice(0, 8)}`
	const groupId = await newGroup(username, { name: 'search-test' })
	const channelId = await getDefaultChannelId(username, groupId)
	const { event } = await postChannelMessage(username, groupId, channelId, {
		text: `hello ${token} world`,
	})
	const eventId = String(event.id).toLowerCase()

	const postedLine = await findChannelMessageRow(username, groupId, channelId, eventId)
	assert(postedLine)
	await indexChannelMessageLine(username, groupId, channelId, postedLine)

	const found = await searchGroupMessages(username, groupId, { q: token, limit: 10 })
	assert(found.items.some(item => item.eventId === eventId && item.text.includes(token)))

	const deleteEvent = await appendChannelMessageDelete(username, groupId, channelId, eventId)
	await indexChannelMessageLine(username, groupId, channelId, {
		type: 'message_delete',
		content: { targetId: eventId },
		hlc: deleteEvent.hlc,
	})
	const afterDelete = await searchGroupMessages(username, groupId, { q: token, limit: 10 })
	assertEquals(afterDelete.items.some(item => item.eventId === eventId), false)
})
