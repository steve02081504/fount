/**
 * 流式生成频道解析：占位条目带 `extension.chat.channelId` 时应直接采用
 * （Hub 生成路径占位条目不进 chatLog，旧实现恒回退 default，
 *  导致非 default 频道流式预览被 Hub 按 channelId 过滤丢弃）。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { createCharBoot } from '../harness.mjs'

const CHAR = 'plain_reply_b'

Deno.test('getChannelForCharStream prefers placeholder channelId over default fallback', async () => {
	const username = `regen-chan-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createCharBoot({ username, chars: CHAR })
	await ensureServer()

	const { getChannelForCharStream } = await import('../../src/chat/session/logEntries.mjs')
	const { chatLogEntry_t } = await import('../../src/chat/session/models.mjs')
	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { getActiveGroupRuntime } = await import('../../src/chat/session/persistence.mjs')

	const groupId = await newGroup(username, { name: 'regen-chan' })
	await addchar(groupId, CHAR, username)

	// 占位条目：Hub 生成路径构造，带真实频道 id 但不在 chatLog 中
	const placeholder = new chatLogEntry_t()
	placeholder.role = 'char'
	placeholder.extension.chat = { channelId: 'some-channel' }
	const chatMetadata = await getActiveGroupRuntime(groupId)
	chatMetadata.chatLog = [new chatLogEntry_t()]

	assertEquals(
		getChannelForCharStream(chatMetadata, placeholder),
		'some-channel',
		'stream channel follows placeholder extension.chat.channelId',
	)
	assertEquals(
		getChannelForCharStream(chatMetadata, new chatLogEntry_t()),
		'default',
		'placeholder without channelId falls back to default',
	)
})
