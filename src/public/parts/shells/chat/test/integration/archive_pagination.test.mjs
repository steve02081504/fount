/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { createIntegrationBoot } from '../harness.mjs'

Deno.test('archive pagination merges same-month rows and walks older months only when needed', async () => {
	const username = `archive-page-${crypto.randomUUID().slice(0, 8)}`
	await createIntegrationBoot({ username, minP2pNode: true }).ensureServer()
	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { getDefaultChannelId, listChannelMessages } = await import('../../src/chat/dag/queries.mjs')
	const { appendPostSnapshotsToArchive } = await import('../../src/chat/archive/index.mjs')
	const { messagesPath } = await import('../../src/chat/lib/paths.mjs')
	const { writeFile, mkdir } = await import('node:fs/promises')
	const { dirname } = await import('node:path')
	const groupId = await newGroup(username)
	const channelId = await getDefaultChannelId(username, groupId)
	/**
	 * 构造一条频道消息行。
	 * @param {string} id eventId 前缀字符
	 * @param {string} date ISO 时间
	 * @returns {object} 消息行
	 */
	const row = (id, date) => ({ eventId: id.repeat(64), type: 'message', channelId, sender: 'sender', hlc: { wall: Date.parse(date) }, timestamp: Date.parse(date), content: { text: id } })
	const old = row('a', '2026-07-01T00:00:00Z')
	const sameMonth = row('b', '2026-08-02T00:00:00Z')
	const hot = [row('c', '2026-08-01T00:00:00Z'), row('d', '2026-08-03T00:00:00Z')]
	await appendPostSnapshotsToArchive(username, groupId, channelId, [old, sameMonth])
	const path = messagesPath(username, groupId, channelId)
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, hot.map(JSON.stringify).join('\n') + '\n')
	const options = { includeArchive: true, decrypt: false, fetchFromPeers: false, limit: 2 }
	assertEquals((await listChannelMessages(username, groupId, channelId, options)).map(line => line.eventId), [sameMonth.eventId, hot[1].eventId])
	assertEquals((await listChannelMessages(username, groupId, channelId, { ...options, before: sameMonth.eventId })).map(line => line.eventId), [old.eventId, hot[0].eventId])
	assertEquals((await listChannelMessages(username, groupId, channelId, { ...options, eventIds: [old.eventId] })).map(line => line.eventId), [old.eventId])
})
