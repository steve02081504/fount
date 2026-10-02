/** 每个 DM 新文本频道独立问候、无可用频道时首次创建、并发去重与 prompt 隔离。 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { createCharBoot, waitUntil } from '../harness.mjs'

const charname = 'dm_greeting_agent'
const { ensureServer, username } = createCharBoot({ username: 'dm-greeting-user', chars: charname })

Deno.test('DM channels greet independently after a cold first create, including a group with no default', async () => {
	await ensureServer()
	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { appendSignedLocalEvent } = await import('../../src/chat/dag/append.mjs')
	const { getState } = await import('../../src/chat/dag/materialize.mjs')
	const { deleteChannel } = await import('../../src/chat/dag/channelOperations.mjs')
	const { addchar, greetDmChannel } = await import('../../src/chat/session/partConfig.mjs')
	const { getChatClient } = await import('../../src/api/client/index.mjs')
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')
	const { getChatRequest } = await import('../../src/chat/session/chatRequest.mjs')
	const { purgeGroupSession } = await import('../../src/chat/session/wsLifecycle.mjs')
	const { ensureLocalAgentEntityHash } = await import('../../src/entity/member.mjs')

	const groupId = await newGroup(username, { name: 'DM greeting' })
	const entityHash = await ensureLocalAgentEntityHash(username, charname)
	await appendSignedLocalEvent(username, groupId, {
		type: 'group_meta_update', timestamp: Date.now(), content: { friendBinding: { charname, entityHash } },
	})
	await deleteChannel(username, groupId, 'default')
	await addchar(groupId, charname, username)
	purgeGroupSession(groupId)
	const client = await getChatClient(username)
	const group = await client.group(groupId)
	const root = (await getState(username, groupId)).state.groupSettings.rootChannelId
	const channels = await Promise.all(['first', 'second'].map(channelId => group.createChannel({
		channelId, type: 'text', name: '', parentChannelId: root, permissionBlockId: root,
	})))
	for (const channel of channels) {
		await waitUntil(async () => (await readChannelMessagesForUser(username, groupId, channel.id)).length === 1, 15_000)
		await Promise.all([greetDmChannel(username, groupId, channel.id), greetDmChannel(username, groupId, channel.id)])
		const lines = await readChannelMessagesForUser(username, groupId, channel.id)
		assertEquals(lines.length, 1)
		assertEquals(lines[0].content.content, `hello:${channel.id}`)
		assertEquals(lines[0].content.extension.chat.isGreeting, true)
		assert(!lines[0].decryptView?.failed)
	}
	purgeGroupSession(groupId)
	for (const channel of channels) {
		const request = await getChatRequest(groupId, charname, channel.id, { replicaUsername: username })
		assertEquals(request.chat_log.filter(entry => entry.content.startsWith('hello:')).map(entry => entry.content), [`hello:${channel.id}`])
	}
	await group.createChannel({ channelId: 'category', type: 'category', parentChannelId: root })
	await greetDmChannel(username, groupId, 'category')
	assertEquals((await readChannelMessagesForUser(username, groupId, 'category')).length, 0)
})
