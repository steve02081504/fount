/**
 * Chat 全文搜索索引与 API（落盘 eventPersist 异步索引钩子回归）。
 */
/* global Deno */
import { createTestSession, waitUntil } from '../harness.mjs'

const getSession = createTestSession({ minP2pNode: true })

Deno.test('searchGroupMessages finds posted text via eventPersist auto-index and removes on delete', async () => {
	const { username } = await getSession()
	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
	const { searchGroupMessages } = await import('../../src/chat/search/index.mjs')
	const { appendChannelMessageDelete } = await import('../../src/chat/channel/messageMutations.mjs')

	const token = `SearchToken${crypto.randomUUID().slice(0, 8)}`
	const groupId = await newGroup(username, { name: 'search-test' })
	const channelId = await getDefaultChannelId(username, groupId)
	const { event } = await postChannelMessage(username, groupId, channelId, {
		text: `hello ${token} world`,
	})
	const eventId = String(event.id).toLowerCase()

	await waitUntil(async () => {
		const found = await searchGroupMessages(username, groupId, { q: token, limit: 10 })
		return found.items.some(item => item.eventId === eventId && item.text.includes(token))
	}, 5000, 40)

	await appendChannelMessageDelete(username, groupId, channelId, eventId)
	await waitUntil(async () => {
		const afterDelete = await searchGroupMessages(username, groupId, { q: token, limit: 10 })
		return !afterDelete.items.some(item => item.eventId === eventId)
	}, 5000, 40)
})
