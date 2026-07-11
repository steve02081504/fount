/**
 * Chat @mention inbox：落盘增量写 + 读取 + seen 水位 + suggest。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createIntegrationBoot } from '../harness.mjs'

Deno.test('maybeAppendMentionInbox append/read/seen and suggestGroupMentions', async () => {
	const username = `mi-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_mention_inbox_',
		minP2pNode: true,
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/crud.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { resolveOperatorEntityHash } = await import('../../src/chat/lib/replica.mjs')
	const {
		maybeAppendMentionInbox,
		readMentionInbox,
		setMentionsSeenAt,
		getMentionsSeenAt,
	} = await import('../../src/chat/lib/mentionInbox.mjs')
	const { suggestGroupMentions } = await import('../../src/group/lib/mentionSuggest.mjs')

	const groupId = await newGroup(username, { name: 'mention-inbox' })
	const channelId = await getDefaultChannelId(username, groupId)
	const viewerHash = (await resolveOperatorEntityHash(username))?.toLowerCase()
	assert(viewerHash, 'operator entity hash')

	const eventId = `${'ab'.repeat(32)}`
	const at = Date.now()
	await maybeAppendMentionInbox(username, groupId, channelId, {
		type: 'message',
		eventId,
		sender: `${'cd'.repeat(32)}`,
		content: { type: 'text', content: `hello @${viewerHash} inbox` },
		hlc: { wall: at },
		timestamp: at,
	})

	const page = await readMentionInbox(username, { limit: 10 })
	assertEquals(page.mentions.length, 1)
	assertEquals(page.mentions[0].eventId, eventId.toLowerCase())
	assertEquals(page.mentions[0].textPreview.includes('hello'), true)
	assertEquals(page.unreadCount, 1)

	const seenAt = Date.now()
	setMentionsSeenAt(username, seenAt)
	assertEquals(getMentionsSeenAt(username), seenAt)

	const afterSeen = await readMentionInbox(username, { limit: 5 })
	assertEquals(afterSeen.unreadCount, 0)

	const { suggestions } = await suggestGroupMentions(username, groupId, '', 20)
	assert(Array.isArray(suggestions))
})

Deno.test('message_edit adding @viewer appends mention inbox row', async () => {
	const username = `mi-edit-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_mention_inbox_edit_',
		minP2pNode: true,
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/crud.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { resolveOperatorEntityHash } = await import('../../src/chat/lib/replica.mjs')
	const { maybeAppendMentionInbox, readMentionInbox } = await import('../../src/chat/lib/mentionInbox.mjs')

	const groupId = await newGroup(username, { name: 'mention-edit' })
	const channelId = await getDefaultChannelId(username, groupId)
	const viewerHash = (await resolveOperatorEntityHash(username))?.toLowerCase()
	assert(viewerHash)

	const targetId = `${'ef'.repeat(32)}`
	const senderKey = `${'12'.repeat(32)}`
	await maybeAppendMentionInbox(username, groupId, channelId, {
		type: 'message_edit',
		eventId: `${'99'.repeat(32)}`,
		sender: senderKey,
		content: {
			targetId,
			newContent: { type: 'text', content: `edited @${viewerHash} ping` },
		},
		hlc: { wall: Date.now() },
	})

	const page = await readMentionInbox(username, { limit: 5 })
	assertEquals(page.mentions.length, 1)
	assertEquals(page.mentions[0].eventId, targetId.toLowerCase())
})

Deno.test('postChannelMessage with @viewer appends mention inbox via eventPersist', async () => {
	const username = `mi-post-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_mention_inbox_post_',
		minP2pNode: true,
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/crud.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
	const { resolveOperatorEntityHash } = await import('../../src/chat/lib/replica.mjs')
	const { readMentionInbox } = await import('../../src/chat/lib/mentionInbox.mjs')

	const groupId = await newGroup(username, { name: 'mention-post' })
	const channelId = await getDefaultChannelId(username, groupId)
	const viewerHash = (await resolveOperatorEntityHash(username))?.toLowerCase()
	assert(viewerHash)

	await postChannelMessage(username, groupId, channelId, { text: `@${viewerHash} from post` })

	await new Promise(resolve => setTimeout(resolve, 50))
	const page = await readMentionInbox(username, { limit: 5 })
	assertEquals(page.unreadCount, 0, 'self @ should not create inbox row')
})
