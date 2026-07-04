/**
 * 群表情联邦入站处理单元测试。
 */
/* global Deno */
import { Buffer } from 'node:buffer'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { bootHeadlessDataRoot } from 'fount/scripts/test/node/boot.mjs'
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	handleFedEmojiData,
	requestGroupEmojiFromPeers,
} from '../../src/chat/federation/groupEmojiFederation.mjs'
import { groupDir } from '../../src/chat/lib/paths.mjs'
import {
	bufferToDataUrl,
	readGroupEmojiBinary,
	resolveGroupEmojiBinaryPath,
} from '../../src/group/groupEmojis.mjs'

/**
 * 在临时 headless 数据根上运行单测。
 * @param {(context: { username: string, groupId: string }) => Promise<void>} run 测试体
 * @returns {Promise<void>}
 */
async function withEmojiFedContext(run) {
	const dataPath = join(tmpdir(), `fount_emoji_fed_${crypto.randomUUID()}`)
	await bootHeadlessDataRoot(dataPath)
	const username = `u_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
	const groupId = `g_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
	await mkdir(groupDir(username, groupId), { recursive: true })
	try {
		await run({ username, groupId })
	}
	finally {
		await rm(dataPath, { recursive: true, force: true })
	}
}

Deno.test('handleFedEmojiData ignores invalid payloads', async () => {
	await withEmojiFedContext(async ({ username, groupId }) => {
		await handleFedEmojiData(username, groupId, null)
		await handleFedEmojiData(username, groupId, { emojiId: '', dataUrl: 'data:image/png;base64,AA==' })
		await handleFedEmojiData(username, groupId, { emojiId: 'e1', dataUrl: 'not-a-data-url' })
		assertEquals(await resolveGroupEmojiBinaryPath(username, groupId, 'e1'), null)
	})
})

Deno.test('handleFedEmojiData rejects dataUrl with mime parameters', async () => {
	await withEmojiFedContext(async ({ username, groupId }) => {
		const bytes = Buffer.from('emoji-bytes')
		const badDataUrl = `data:image/png;charset=utf-8;base64,${bytes.toString('base64')}`
		await handleFedEmojiData(username, groupId, {
			emojiId: 'bad-mime',
			dataUrl: badDataUrl,
			mimeType: 'image/png',
		})
		assertEquals(await resolveGroupEmojiBinaryPath(username, groupId, 'bad-mime'), null)
	})
})

Deno.test('handleFedEmojiData persists valid dataUrl bytes', async () => {
	await withEmojiFedContext(async ({ username, groupId }) => {
		const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])
		const dataUrl = bufferToDataUrl(bytes, 'image/png')
		await handleFedEmojiData(username, groupId, {
			emojiId: 'good-emoji',
			dataUrl,
			mimeType: 'image/png',
		})
		const local = await readGroupEmojiBinary(username, groupId, 'good-emoji')
		assert(local)
		assertEquals(Buffer.compare(local.buffer, bytes), 0)
		assertEquals(local.mimeType, 'image/png')
	})
})

Deno.test('bufferToDataUrl strips mime parameters before encoding', () => {
	const bytes = Buffer.from('x')
	const dataUrl = bufferToDataUrl(bytes, 'image/png;charset=utf-8')
	assertEquals(dataUrl.startsWith('data:image/png;base64,'), true)
	assertEquals(dataUrl.includes('charset'), false)
})

Deno.test('handleFedEmojiData resolves pending peer fetch', async () => {
	await withEmojiFedContext(async ({ username, groupId }) => {
		const emojiId = 'pending-emoji'
		const bytes = Buffer.from('pending-fed-emoji')
		const dataUrl = bufferToDataUrl(bytes, 'image/png')
		const slot = {
			/** @returns {{ peerId: string }[]} 在线 peer 列表 */
			getRoster() {
				return [{ peerId: 'peer-1' }]
			},
			/** @returns {void} 发送 want 请求 */
			sendEmojiWant() {},
		}
		const pending = requestGroupEmojiFromPeers(username, groupId, emojiId, slot)
		await handleFedEmojiData(username, groupId, { emojiId, dataUrl, mimeType: 'image/png' })
		const resolved = await pending
		assert(resolved)
		assertEquals(resolved.mimeType, 'image/png')
		assertEquals(resolved.dataUrl, dataUrl)
		const local = await readGroupEmojiBinary(username, groupId, emojiId)
		assert(local)
		assertEquals(Buffer.compare(local.buffer, bytes), 0)
	})
})
