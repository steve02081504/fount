/**
 * 消息扩展字段与 member-read-markers 侧车。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createIntegrationBoot } from '../harness.mjs'

Deno.test('postChannelMessage persists locale content_warning', async () => {
	const username = `mf-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_message_fields_',
		minP2pNode: true,
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')

	const groupId = await newGroup(username, { name: 'fields' })
	const channelId = await getDefaultChannelId(username, groupId)
	const { event } = await postChannelMessage(username, groupId, channelId, {
		rawContent: {
			type: 'text',
			content: 'hello spoilers',
			locale: 'en-US',
			content_warning: 'cw',
			sensitive_media: true,
			embeds: [{ url: 'https://example.com', title: 'Ex' }],
		},
	})
	assertEquals(!!event.id, true)

	const rows = await readChannelMessagesForUser(username, groupId, channelId, { limit: 10 })
	const row = rows.find(r => r.eventId === event.id)
	assertEquals(row?.content?.locale, 'en-US')
	assertEquals(row?.content?.content_warning, 'cw')
	assertEquals(row?.content?.sensitive_media, true)
	assertEquals(row?.content?.embeds, undefined)
})

Deno.test('member-read-markers sidecar records put markRead', async () => {
	const username = `mm-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_member_markers_',
		minP2pNode: true,
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
	const {
		setGroupMemberReadMarker,
		loadGroupMemberReadMarkers,
	} = await import('../../src/chat/lib/groupMemberReadMarkers.mjs')
	const { resolveOperatorEntityHashForUser } = await import('../../src/entity/identity.mjs')

	const groupId = await newGroup(username, { name: 'markers' })
	const channelId = await getDefaultChannelId(username, groupId)
	const { event } = await postChannelMessage(username, groupId, channelId, { text: 'mark me' })
	const entityHash = await resolveOperatorEntityHashForUser(username)
	const marker = { eventId: event.id, seq: 1 }
	setGroupMemberReadMarker(username, groupId, channelId, entityHash, marker)
	const all = loadGroupMemberReadMarkers(username, groupId)
	assertEquals(all[channelId][entityHash].seq, 1)
	assertEquals(all[channelId][entityHash].eventId, event.id)
})
