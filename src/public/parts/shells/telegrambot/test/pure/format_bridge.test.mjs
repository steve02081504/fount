/**
 * telegrambot format 纯测试（DTO / 贴纸 / FormatOutboundReply 契约）。
 */
/* global Deno */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createTestServerBoot } from 'fount/scripts/test/node/boot.mjs'
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'


import {
	aiMarkdownToTelegramHtml,
	extractStickerIdsFromMarkdown,
	splitTelegramReply,
	telegramMessageToBridgeDto,
} from '../../src/format.mjs'

/**
 * 对齐 telegrambot default_interface 出站分支：FormatOutboundReply 返回 true 则跳过默认 HTML。
 * @param {{ FormatOutboundReply?: Function, replyEntry: object, plainText: string, send: Function }} args 参数
 * @returns {Promise<{ path: 'custom' | 'default', htmlParts: string[], stickerIds: string[], sendCalls: object[] }>} 走过的分支与出站记录
 */
async function dispatchTelegramOutbound({ FormatOutboundReply, replyEntry, plainText, send }) {
	const { cleanMarkdown, stickerIds } = extractStickerIdsFromMarkdown(plainText)
	/** @type {object[]} */
	const sendCalls = []
	/**
	 * @param {object} payload 出站载荷
	 * @returns {Promise<object>} send 的返回值
	 */
	const trackedSend = async payload => {
		sendCalls.push(payload)
		return send(payload)
	}

	if (await FormatOutboundReply?.(replyEntry, {
		platform: 'telegram',
		send: trackedSend,
	}))
		return { path: 'custom', htmlParts: [], stickerIds, sendCalls }

	/** @type {string[]} */
	const htmlParts = []
	if (cleanMarkdown.trim()) 
		for (const part of splitTelegramReply(aiMarkdownToTelegramHtml(cleanMarkdown))) {
			htmlParts.push(part)
			await trackedSend({ text: part })
		}
	
	if (stickerIds.length)
		await trackedSend({ stickerIds })
	return { path: 'default', htmlParts, stickerIds, sendCalls }
}

Deno.test('splitTelegramReply splits long HTML safely', () => {
	const parts = splitTelegramReply('a'.repeat(5000), 4096)
	assertEquals(parts.length, 2)
	assertEquals(parts.join('').length, 5000)
})

Deno.test('aiMarkdownToTelegramHtml bold', () => {
	const html = aiMarkdownToTelegramHtml('**hi**')
	assertEquals(html.includes('<b>hi</b>'), true)
})

Deno.test('extractStickerIdsFromMarkdown strips stickers for outbound', () => {
	const { cleanMarkdown, stickerIds } = extractStickerIdsFromMarkdown(
		'hello <:CA_sticker_id:set_name:😀> world <:CB_id:other:>',
	)
	assertEquals(stickerIds, ['CA_sticker_id', 'CB_id'])
	assertEquals(cleanMarkdown, 'hello world')
})

Deno.test('FormatOutboundReply true skips default HTML path and still uses send', async () => {
	/** @type {string[]} */
	const defaultHtmlSeen = []
	const result = await dispatchTelegramOutbound({
		replyEntry: { content: 'ignored-by-custom' },
		plainText: '**should not become default html** <:sticker_file:set:>',
		/**
		 * @param {object} _entry 回复条目（此测试不使用）
		 * @param {{ send: Function }} root0 出站上下文
		 * @param {Function} root0.send 出站发送函数
		 * @returns {Promise<boolean>} true 表示接管出站
		 */
		FormatOutboundReply: async (_entry, { send }) => {
			await send({ text: 'custom-body' })
			return true
		},
		/**
		 * @param {object} payload 出站载荷
		 * @returns {Promise<object>} 模拟发送结果
		 */
		send: async payload => {
			if (payload.text?.includes('<b>'))
				defaultHtmlSeen.push(payload.text)
			return { platformMessageId: 1 }
		},
	})
	assertEquals(result.path, 'custom')
	assertEquals(result.sendCalls.length, 1)
	assertEquals(result.sendCalls[0].text, 'custom-body')
	assertEquals(defaultHtmlSeen.length, 0)
	assertEquals(result.htmlParts.length, 0)
})

Deno.test('default outbound path formats HTML and forwards sticker ids', async () => {
	const result = await dispatchTelegramOutbound({
		replyEntry: { content: 'plain' },
		plainText: '**hi** <:file_ABC:cool_set:🎉>',
		/** @returns {Promise<object>} 模拟发送结果 */
		send: async () => ({ platformMessageId: 2 }),
	})
	assertEquals(result.path, 'default')
	assertEquals(result.stickerIds, ['file_ABC'])
	assert(result.htmlParts.some(part => part.includes('<b>hi</b>')))
	assert(result.sendCalls.some(call => call.text?.includes('<b>hi</b>')))
	assert(result.sendCalls.some(call => Array.isArray(call.stickerIds) && call.stickerIds.includes('file_ABC')))
})

Deno.test('telegramMessageToBridgeDto maps mock Telegraf message with mention rewrite', async () => {
	const username = `tg-dto-${crypto.randomUUID().slice(0, 8)}`
	const dataDir = mkdtempSync(join(tmpdir(), 'fount_tg_dto_'))
	await createTestServerBoot({
		username,
		dataDir,
		minP2pNode: true,
		loadParts: ['shells/chat'],
	})()

	const { bridgeEntityHash } = await import('../../../chat/src/chat/bridge/identity.mjs')
	const mentionUserId = 424242
	const expectedHash = bridgeEntityHash('telegram', mentionUserId)
	const message = {
		message_id: 77,
		date: 1_700_000_000,
		text: 'ping @Alice please',
		entities: [{
			type: 'text_mention',
			offset: 5,
			length: 6,
			user: { id: mentionUserId, is_bot: false, first_name: 'Alice' },
		}],
		from: { id: 11, first_name: 'Bob', last_name: 'Builder', username: 'bob' },
		chat: { id: -100123, type: 'supergroup', title: 'Bridge Group' },
		message_thread_id: 9,
		reply_to_message: { message_id: 66 },
		sticker: {
			file_id: 'STICKER_FILE',
			set_name: 'demo_set',
			emoji: '🙂',
		},
	}

	const dto = await telegramMessageToBridgeDto({}, message, { id: 1, username: 'bot' }, username)
	assert(dto)
	assertEquals(dto.platform, 'telegram')
	assertEquals(dto.platformChatId, -100123)
	assertEquals(dto.platformThreadId, 9)
	assertEquals(dto.platformMessageId, 77)
	assertEquals(dto.chatKind, 'group')
	assertEquals(dto.chatName, 'Bridge Group')
	assertEquals(dto.author.platformUserId, 11)
	assertEquals(dto.author.displayName, 'Bob Builder (@bob)')
	assertEquals(dto.replyToPlatformMessageId, 66)
	assertEquals(dto.timestamp, 1_700_000_000_000)
	assert(dto.text.includes(`@[entity:${expectedHash}]`))
	assert(dto.text.includes('<:STICKER_FILE:demo_set:🙂>'))
	assert(!dto.text.includes('@Alice'))
})
