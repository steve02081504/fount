/**
 * 频道附件：落盘无 `[image:]` 标记，files 描述符齐全，搜索索引干净。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assert, assertEquals, assertFalse } from 'jsr:@std/assert'

import { createIntegrationBoot, waitUntil } from '../harness.mjs'

/** 1×1 PNG 测试数据 */
const TINY_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64',
)

Deno.test('postChannelMessage image attaches files without inline markers', async () => {
	const username = `att-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({ username, minP2pNode: true })
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')
	const { searchGroupMessages } = await import('../../src/chat/search/index.mjs')
	const { messageShowText } = await import('../../public/shared/channelContent.mjs')

	const token = `ImgTok${crypto.randomUUID().slice(0, 8)}`
	const groupId = await newGroup(username, { name: 'attach-test' })
	const channelId = await getDefaultChannelId(username, groupId)
	const { event, fileIds } = await postChannelMessage(username, groupId, channelId, {
		text: `caption ${token}`,
		files: [{ name: 'tiny.png', mime_type: 'image/png', buffer: TINY_PNG }],
	})

	assert((fileIds || []).length >= 1, 'fileIds required')
	assertFalse(String(event.content?.content ?? '').includes('[image:'))

	const rows = await readChannelMessagesForUser(username, groupId, channelId, { limit: 10 })
	const row = rows.find(candidate => candidate.eventId === event.id)
	assert(row, 'view-log row missing')
	assert((row.content?.files || []).length >= 1, 'files descriptor required')
	assert(row.content.files[0].fileId, 'fileId required')
	assertEquals(row.content.files[0].mime_type, 'image/png')
	assertFalse(messageShowText(row.content).includes('[image:'))
	assertFalse(String(row.content?.content ?? '').includes('[image:'))

	await waitUntil(async () => {
		const found = await searchGroupMessages(username, groupId, { q: token, limit: 10 })
		const hit = found.items.find(item => item.eventId === String(event.id).toLowerCase())
		const text = String(hit?.text || '')
		return !!hit && text.includes(token) && !text.includes('[image:')
	}, 5000, 40)

	const { groupEntityHash } = await import('../../public/shared/groupEntityHash.mjs')
	const { loadFileManifest, readManifestPlaintext, readManifestPlaintextStream } = await import('npm:@steve02081504/fount-p2p/files/evfs')
	const { buffer: consumeStream } = await import('node:stream/consumers')
	const entityHash = groupEntityHash(groupId)
	const { fileId } = row.content.files[0]
	const manifest = await loadFileManifest(entityHash, `chat/${fileId}`)
	assert(manifest, `EVFS manifest missing for chat/${fileId}`)
	const plain = await readManifestPlaintext(username, manifest, { username })
	assert(plain?.byteLength, 'EVFS plaintext unavailable')
	assertEquals(Buffer.from(plain).equals(TINY_PNG), true, 'EVFS plaintext mismatch')

	// HTTP GET 走 stream 路径；parts[].size 若误标明文长度会导致 decrypt 失败 → ERR_EMPTY_RESPONSE
	const stream = await readManifestPlaintextStream(username, manifest, { username })
	assert(stream, 'EVFS plaintext stream unavailable')
	const streamed = await consumeStream(stream)
	assertEquals(Buffer.from(streamed).equals(TINY_PNG), true, 'EVFS stream plaintext mismatch')
})
