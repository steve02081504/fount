/**
 * 频道归档导出/导入 integration：终态消息、墓碑、来源标记、新频道。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createIntegrationBoot } from '../harness.mjs'

Deno.test('channel archive export/import round-trip preserves final view and provenance', async () => {
	const username = `ca-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		minP2pNode: true,
	})
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
	const { appendChannelMessageEdit, appendChannelMessageDelete } = await import('../../src/chat/channel/messageMutations.mjs')
	const { appendReactionEvent } = await import('../../src/chat/dag/channelOperations.mjs')
	const { exportChannelArchive, importChannelArchive } = await import('../../src/chat/channelArchive.mjs')
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')
	const { getState } = await import('../../src/chat/dag/materialize.mjs')

	const groupId = await newGroup(username)
	const channelId = await getDefaultChannelId(username, groupId)

	const keep = await postChannelMessage(username, groupId, channelId, {
		text: 'keep-me',
		origin: 'human',
	})
	const editTarget = await postChannelMessage(username, groupId, channelId, {
		text: 'before-edit',
		origin: 'human',
	})
	await appendChannelMessageEdit(username, groupId, channelId, editTarget.event.id, {
		type: 'text',
		content: 'after-edit',
	})
	const delTarget = await postChannelMessage(username, groupId, channelId, {
		text: 'to-delete',
		origin: 'human',
	})
	await appendChannelMessageDelete(username, groupId, channelId, delTarget.event.id)
	await appendReactionEvent(username, groupId, {
		type: 'reaction_add',
		channelId,
		targetEventId: keep.event.id,
		emoji: '👍',
	})

	const archive = await exportChannelArchive(username, groupId, channelId)
	assertEquals(archive.format, 'fount-channel-archive')
	assertEquals(archive.version, 2)
	assert(archive.messages.some(m => m.content?.content === 'after-edit' && m.wasEdited))
	assert(archive.messages.some(m => m.deleted))
	const kept = archive.messages.find(m => m.sourceEventId === keep.event.id)
	assertEquals(kept?.reactionCounts?.['👍'], 1)
	assert(kept?.sourceSenderPubKeyHash)

	const { channelId: importedId, messageCount } = await importChannelArchive(username, groupId, archive)
	assert(importedId.startsWith('imported_'))
	assert(messageCount >= 3)

	const { state } = await getState(username, groupId)
	assertEquals(state.channels[importedId]?.type, 'text')

	const rows = await readChannelMessagesForUser(username, groupId, importedId, { limit: 50 })
	assert(rows.some(row => row.content?.content === 'after-edit'))
	const importedKeep = rows.find(row => row.content?.importedFrom?.eventId === keep.event.id)
	assert(importedKeep)
	assertEquals(importedKeep.content.importedFrom.attributionMismatch, true)
	assert(importedKeep.content.importedFrom.signerEntityHash)
	assert(importedKeep.content.importedFrom.sourceSenderPubKeyHash)
	assert(rows.every(row => !row.content?.fileIds?.length))
})
