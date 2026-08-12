/**
 * telegrambot format 纯测试（DTO / 贴纸 / FormatOutboundReply 契约）。
 */
/* global Deno */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createTestServerBoot } from 'fount/scripts/test/node/boot.mjs'
import { assert, assertEquals } from 'jsr:@std/assert'


import {
	aiMarkdownToTelegramHtml,
	extractStickerIdsFromMarkdown,
	splitTelegramReply,
	telegramEntitiesToAiMarkdown,
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

Deno.test('telegramEntitiesToAiMarkdown merges bold text_mention into one span', () => {
	const text = 'hey Alice!'
	const markdown = telegramEntitiesToAiMarkdown(text, [
		{ type: 'bold', offset: 4, length: 5 },
		{
			type: 'text_mention',
			offset: 4,
			length: 5,
			user: { id: 42, is_bot: false, first_name: 'Alice' },
		},
	])
	assertEquals(markdown, 'hey **@[Alice (UserID:42)]**!')
	assertEquals(markdown.includes('Alice**'), false)
	assertEquals(markdown.includes('**Alice'), false)
})

Deno.test('telegramEntitiesToAiMarkdown nests text_mention inside wider bold', () => {
	const text = 'hello Alice end'
	const markdown = telegramEntitiesToAiMarkdown(text, [
		{ type: 'bold', offset: 0, length: 11 },
		{
			type: 'text_mention',
			offset: 6,
			length: 5,
			user: { id: 7, is_bot: false, first_name: 'Alice' },
		},
	])
	assertEquals(markdown, '**hello @[Alice (UserID:7)]** end')
})

Deno.test('telegramEntitiesToAiMarkdown blockquote prefixes every line', () => {
	const markdown = telegramEntitiesToAiMarkdown('foo\nbar', [
		{ type: 'blockquote', offset: 0, length: 7 },
	])
	assertEquals(markdown, '> foo\n> bar')
})

Deno.test('telegramMessageToBridgeDto remaps text_mention on later blockquote line', async () => {
	const username = `tg-bq-${crypto.randomUUID().slice(0, 8)}`
	const dataDir = mkdtempSync(join(tmpdir(), 'fount_tg_bq_'))
	await createTestServerBoot({
		username,
		dataDir,
		minP2pNode: true,
		loadParts: ['shells/chat'],
	})()

	const { bridgeEntityHash } = await import('../../../chat/src/chat/bridge/identity.mjs')
	const mentionUserId = 991122
	const expectedHash = bridgeEntityHash('telegram', mentionUserId)
	const message = {
		message_id: 1,
		date: 1_700_000_000,
		text: 'foo\nbar',
		entities: [
			{ type: 'blockquote', offset: 0, length: 7 },
			{
				type: 'text_mention',
				offset: 4,
				length: 3,
				user: { id: mentionUserId, is_bot: false, first_name: 'bar' },
			},
		],
		from: { id: 11, first_name: 'Bob', is_bot: false },
		chat: { id: 1, type: 'private' },
	}

	const dto = await telegramMessageToBridgeDto({}, message, { id: 1, username: 'bot' }, username)
	assert(dto)
	assertEquals(dto.text, `> foo\n> @[entity:${expectedHash}]`)
})

Deno.test('telegramMessageToBridgeDto remaps same-span blockquote text_mention', async () => {
	const username = `tg-bq1-${crypto.randomUUID().slice(0, 8)}`
	const dataDir = mkdtempSync(join(tmpdir(), 'fount_tg_bq1_'))
	await createTestServerBoot({
		username,
		dataDir,
		minP2pNode: true,
		loadParts: ['shells/chat'],
	})()

	const { bridgeEntityHash } = await import('../../../chat/src/chat/bridge/identity.mjs')
	const mentionUserId = 334455
	const expectedHash = bridgeEntityHash('telegram', mentionUserId)
	const message = {
		message_id: 2,
		date: 1_700_000_000,
		text: 'Alice',
		entities: [
			{ type: 'blockquote', offset: 0, length: 5 },
			{
				type: 'text_mention',
				offset: 0,
				length: 5,
				user: { id: mentionUserId, is_bot: false, first_name: 'Alice' },
			},
		],
		from: { id: 11, first_name: 'Bob', is_bot: false },
		chat: { id: 1, type: 'private' },
	}

	const dto = await telegramMessageToBridgeDto({}, message, { id: 1, username: 'bot' }, username)
	assert(dto)
	assertEquals(dto.text, `> @[entity:${expectedHash}]`)
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
	assertEquals(dto.author.displayName, 'Bob Builder')
	assertEquals(dto.replyToPlatformMessageId, 66)
	assertEquals(dto.timestamp, 1_700_000_000_000)
	assert(dto.text.includes(`@[entity:${expectedHash}]`))
	assert(dto.text.includes('<:STICKER_FILE:demo_set:🙂>'))
	assert(!dto.text.includes('@Alice'))
	assert(!dto.text.includes('UserID:'))
})

Deno.test('telegramMessageToBridgeDto rewrites mention after leading emoji', async () => {
	const username = `tg-emoji-mention-${crypto.randomUUID().slice(0, 8)}`
	const dataDir = mkdtempSync(join(tmpdir(), 'fount_tg_emoji_mention_'))
	await createTestServerBoot({
		username,
		dataDir,
		minP2pNode: true,
		loadParts: ['shells/chat'],
	})()

	const { bridgeEntityHash } = await import('../../../chat/src/chat/bridge/identity.mjs')
	const mentionUserId = 616161
	const expectedHash = bridgeEntityHash('telegram', mentionUserId)
	// "👋 Alice" — emoji is 2 UTF-16 units, so Alice starts at offset 3
	const message = {
		message_id: 89,
		date: 1_700_000_200,
		text: '👋 Alice',
		entities: [{
			type: 'text_mention',
			offset: 3,
			length: 5,
			user: { id: mentionUserId, is_bot: false, first_name: 'Alice' },
		}],
		from: { id: 13, first_name: 'Dave' },
		chat: { id: -100888, type: 'supergroup', title: 'Emoji Group' },
	}

	const dto = await telegramMessageToBridgeDto({}, message, { id: 1, username: 'bot' }, username)
	assert(dto)
	assertEquals(dto.text.includes(`@[entity:${expectedHash}]`), true)
	assertEquals(dto.text.includes('Alice'), false)
	assertEquals(dto.text.startsWith('👋 '), true)
})

Deno.test('telegramMessageToBridgeDto remaps mention offsets after earlier markdown entities', async () => {
	const username = `tg-offset-${crypto.randomUUID().slice(0, 8)}`
	const dataDir = mkdtempSync(join(tmpdir(), 'fount_tg_offset_'))
	await createTestServerBoot({
		username,
		dataDir,
		minP2pNode: true,
		loadParts: ['shells/chat'],
	})()

	const { bridgeEntityHash } = await import('../../../chat/src/chat/bridge/identity.mjs')
	const mentionUserId = 515151
	const expectedHash = bridgeEntityHash('telegram', mentionUserId)
	// "hi X there Alice end" — bold on "X" shifts later mention offsets in markdown
	const message = {
		message_id: 88,
		date: 1_700_000_100,
		text: 'hi X there Alice end',
		entities: [
			{ type: 'bold', offset: 3, length: 1 },
			{
				type: 'text_mention',
				offset: 11,
				length: 5,
				user: { id: mentionUserId, is_bot: false, first_name: 'Alice' },
			},
		],
		from: { id: 12, first_name: 'Carol' },
		chat: { id: -100999, type: 'supergroup', title: 'Offset Group' },
	}

	const dto = await telegramMessageToBridgeDto({}, message, { id: 1, username: 'bot' }, username)
	assert(dto)
	assert(dto.text.includes('**X**'))
	assert(dto.text.includes(`@[entity:${expectedHash}]`))
	assert(!dto.text.includes('Alice'))
	assert(!dto.text.includes('UserID:'))
})

Deno.test('telegramMessageToBridgeDto rewrites bold text_mention without duplicating text', async () => {
	const username = `tg-bold-mention-${crypto.randomUUID().slice(0, 8)}`
	const dataDir = mkdtempSync(join(tmpdir(), 'fount_tg_bold_mention_'))
	await createTestServerBoot({
		username,
		dataDir,
		minP2pNode: true,
		loadParts: ['shells/chat'],
	})()

	const { bridgeEntityHash } = await import('../../../chat/src/chat/bridge/identity.mjs')
	const mentionUserId = 313131
	const expectedHash = bridgeEntityHash('telegram', mentionUserId)
	const message = {
		message_id: 90,
		date: 1_700_000_300,
		text: 'ping Alice now',
		entities: [
			{ type: 'bold', offset: 5, length: 5 },
			{
				type: 'text_mention',
				offset: 5,
				length: 5,
				user: { id: mentionUserId, is_bot: false, first_name: 'Alice' },
			},
		],
		from: { id: 14, first_name: 'Eve' },
		chat: { id: -100777, type: 'supergroup', title: 'Bold Mention Group' },
	}

	const dto = await telegramMessageToBridgeDto({}, message, { id: 1, username: 'bot' }, username)
	assert(dto)
	assertEquals(dto.text, `ping **@[entity:${expectedHash}]** now`)
})

Deno.test('telegramEntitiesToAiMarkdown nests text_mention inside text_link+code', () => {
	const text = 'go Alice now'
	const markdown = telegramEntitiesToAiMarkdown(text, [
		{ type: 'text_link', offset: 0, length: 12, url: 'https://example.com' },
		{ type: 'code', offset: 0, length: 12 },
		{
			type: 'text_mention',
			offset: 3,
			length: 5,
			user: { id: 55, is_bot: false, first_name: 'Alice' },
		},
	])
	assertEquals(markdown, '`[go @[Alice (UserID:55)] now](https://example.com)`')
})

Deno.test('telegramMessageToBridgeDto remaps same-span code text_mention', async () => {
	const username = `tg-code-mention-${crypto.randomUUID().slice(0, 8)}`
	const dataDir = mkdtempSync(join(tmpdir(), 'fount_tg_code_mention_'))
	await createTestServerBoot({
		username,
		dataDir,
		minP2pNode: true,
		loadParts: ['shells/chat'],
	})()

	const { bridgeEntityHash } = await import('../../../chat/src/chat/bridge/identity.mjs')
	const mentionUserId = 727272
	const expectedHash = bridgeEntityHash('telegram', mentionUserId)
	const message = {
		message_id: 91,
		date: 1_700_000_400,
		text: 'Alice',
		entities: [
			{ type: 'code', offset: 0, length: 5 },
			{
				type: 'text_mention',
				offset: 0,
				length: 5,
				user: { id: mentionUserId, is_bot: false, first_name: 'Alice' },
			},
		],
		from: { id: 15, first_name: 'Frank' },
		chat: { id: -100666, type: 'supergroup', title: 'Code Mention Group' },
	}

	const dto = await telegramMessageToBridgeDto({}, message, { id: 1, username: 'bot' }, username)
	assert(dto)
	assertEquals(dto.text, `\`@[entity:${expectedHash}]\``)
})

Deno.test('telegramMessageToBridgeDto remaps nested text_mention under text_link+code', async () => {
	const username = `tg-link-code-mention-${crypto.randomUUID().slice(0, 8)}`
	const dataDir = mkdtempSync(join(tmpdir(), 'fount_tg_link_code_mention_'))
	await createTestServerBoot({
		username,
		dataDir,
		minP2pNode: true,
		loadParts: ['shells/chat'],
	})()

	const { bridgeEntityHash } = await import('../../../chat/src/chat/bridge/identity.mjs')
	const mentionUserId = 838383
	const expectedHash = bridgeEntityHash('telegram', mentionUserId)
	const message = {
		message_id: 92,
		date: 1_700_000_500,
		text: 'go Alice now',
		entities: [
			{ type: 'text_link', offset: 0, length: 12, url: 'https://example.com' },
			{ type: 'code', offset: 0, length: 12 },
			{
				type: 'text_mention',
				offset: 3,
				length: 5,
				user: { id: mentionUserId, is_bot: false, first_name: 'Alice' },
			},
		],
		from: { id: 16, first_name: 'Gina' },
		chat: { id: -100555, type: 'supergroup', title: 'Link Code Mention Group' },
	}

	const dto = await telegramMessageToBridgeDto({}, message, { id: 1, username: 'bot' }, username)
	assert(dto)
	assertEquals(dto.text, `\`[go @[entity:${expectedHash}] now](https://example.com)\``)
})

Deno.test('rewriteTelegramMentionsToFount rewrites @BotUsername mention entity', async () => {
	const username = `tg-mention-${crypto.randomUUID().slice(0, 8)}`
	const dataDir = mkdtempSync(join(tmpdir(), 'fount_tg_mention_'))
	await createTestServerBoot({
		username,
		dataDir,
		minP2pNode: true,
		loadParts: ['shells/chat'],
	})()

	const { seedStubCharPart } = await import('../../../chat/test/harness.mjs')
	const { claimAgentBridgeIdentity, bridgeEntityHash } = await import('../../../chat/src/chat/bridge/identity.mjs')
	const { ensureLocalAgentEntityHash } = await import('../../../chat/src/entity/member.mjs')
	const botId = 900001
	const botUsername = 'MockTgBot'
	const charPartName = 'on_message_yes'
	await seedStubCharPart(dataDir, username, charPartName)
	// 未绑定前为伪 hash；绑定后为 char hash
	const unbound = bridgeEntityHash('telegram', botId)
	const { rewriteTelegramMentionsToFount } = await import('../../src/format.mjs')
	const mention = `@${botUsername}`
	const text = `${mention} hi`
	const entities = [{ type: 'mention', offset: 0, length: mention.length }]
	const before = await rewriteTelegramMentionsToFount(username, text, entities, {
		id: botId, username: botUsername,
	})
	assert(before.includes(`@[entity:${unbound}]`))

	await claimAgentBridgeIdentity(username, 'telegram', botId, charPartName, botUsername)
	const charHash = await ensureLocalAgentEntityHash(username, charPartName)
	const after = await rewriteTelegramMentionsToFount(username, text, entities, {
		id: botId, username: botUsername,
	})
	assert(after.includes(`@[entity:${charHash}]`))
	assert(!after.includes(mention))
})
