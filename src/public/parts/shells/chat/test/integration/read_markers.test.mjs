/**
 * M5：read-marker + message seq + 群列表未读摘要。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createIntegrationBoot } from '../harness.mjs'

Deno.test('message seq monotonic and read-marker clears unread summary', async () => {
	const username = `rm-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_read_marker_',
		minP2pNode: true,
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/crud.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
	const { readChannelMessagesForUser, enumerateJoinedFederatedGroups } = await import('../../src/group/queries.mjs')
	const {
		getChannelReadMarker,
		setChannelReadMarker,
		summarizeGroupUnread,
	} = await import('../../src/chat/lib/readMarkers.mjs')
	const { getState } = await import('../../src/chat/dag/materialize.mjs')

	const groupId = await newGroup(username, { name: 'read-marker' })
	const channelId = await getDefaultChannelId(username, groupId)

	await postChannelMessage(username, groupId, channelId, { text: 'one' })
	await postChannelMessage(username, groupId, channelId, { text: 'two' })

	const messages = await readChannelMessagesForUser(username, groupId, channelId, { limit: 10 })
	const seqs = messages.filter(row => row.type === 'message').map(row => Number(row.seq))
	assertEquals(seqs.length, 2)
	assert(seqs[0] < seqs[1], 'seq increases')

	const { state } = await getState(username, groupId)
	const beforeMarker = getChannelReadMarker(username, groupId, channelId)
	const unreadBefore = summarizeGroupUnread(state, beforeMarker ? { [channelId]: beforeMarker } : {})
	assertEquals(unreadBefore.unreadCount, 2)

	const first = messages.find(row => row.type === 'message')
	setChannelReadMarker(username, groupId, channelId, { eventId: first.eventId, seq: first.seq })

	const marker = getChannelReadMarker(username, groupId, channelId)
	assertEquals(marker?.seq, first.seq)

	const { state: stateAfter } = await getState(username, groupId)
	const unreadAfter = summarizeGroupUnread(stateAfter, { [channelId]: marker })
	assertEquals(unreadAfter.unreadCount, 1)

	const groups = await enumerateJoinedFederatedGroups(username)
	const row = groups.find(entry => entry.groupId === groupId)
	assert(row, 'group list row')
	assertEquals(row.unreadCount, 1)
	assertEquals(row.channelUnread[channelId], 1)
})
