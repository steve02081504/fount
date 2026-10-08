/** 消息提交后缓存、tail 与 DAG 一致，编辑删除无需重建 runtime。 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { createIntegrationBoot } from '../harness.mjs'

Deno.test('cached runtime and tail observe local encrypted sends, edits and deletes immediately', async () => {
	const username = `runtime-${crypto.randomUUID().slice(0, 8)}`
	await createIntegrationBoot({ username, minP2pNode: true }).ensureServer()
	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { getGroupRuntime, rebuildGroupRuntime, invalidateGroupRuntime } = await import('../../src/chat/session/runtime.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
	const { appendSignedLocalEvent } = await import('../../src/chat/dag/append.mjs')
	const { actions } = await import('../../src/actions.mjs')
	const groupId = await newGroup(username)
	const runtime = await getGroupRuntime(groupId, username)
	await appendSignedLocalEvent(username, groupId, {
		type: 'group_settings_update', timestamp: Date.now(), content: { defaultChannelId: null },
	})
	const first = await postChannelMessage(username, groupId, 'default', { text: 'first plaintext' })
	const second = await postChannelMessage(username, groupId, 'default', { text: 'second plaintext' })
	assertEquals(await getGroupRuntime(groupId, username) === runtime, true, 'the cached object stays live')
	assertEquals(runtime.chatLog.map(entry => entry.content), ['first plaintext', 'second plaintext'])
	assertEquals((await actions.tail({ groupId, n: 10 })).map(entry => entry.content), ['first plaintext', 'second plaintext'])
	await appendSignedLocalEvent(username, groupId, {
		type: 'message_edit', channelId: 'default', timestamp: Date.now(),
		content: { targetId: second.event.id, newContent: { content: 'edited plaintext' } },
	})
	assertEquals(runtime.chatLog.map(entry => entry.content), ['first plaintext', 'edited plaintext'])
	await appendSignedLocalEvent(username, groupId, {
		type: 'message_delete', channelId: 'default', timestamp: Date.now(), content: { targetId: first.event.id },
	})
	assertEquals(runtime.chatLog.map(entry => entry.content), ['edited plaintext'])
	assertEquals((await rebuildGroupRuntime(groupId, username)).chatLog.map(entry => entry.content), ['edited plaintext'])
	invalidateGroupRuntime(groupId)
	const [coldA, coldB] = await Promise.all([getGroupRuntime(groupId, username), getGroupRuntime(groupId, username)])
	assertEquals(coldA === coldB, true, 'concurrent cold readers share one runtime instance')
	const { chatLogEntry_t } = await import('../../src/chat/session/models.mjs')
	const { addChatLogEntry } = await import('../../src/chat/session/chatLogAppend.mjs')
	const privateEntry = new chatLogEntry_t()
	privateEntry.content = 'local context'
	privateEntry.role = 'system'
	privateEntry.charVisibility = ['local-agent']
	privateEntry.extension.timeSlice = coldA.LastTimeSlice.copy()
	privateEntry.extension.chat = { channelId: 'default' }
	await addChatLogEntry(groupId, privateEntry)
	await postChannelMessage(username, groupId, 'default', { text: 'after local context' })
	assertEquals(coldA.chatLog.includes(privateEntry), true, 'message synchronization preserves local-only context')
})
