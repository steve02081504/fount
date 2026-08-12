/**
 * Telegram OnMessage 契约：DM 主人、@BotUsername、listMembers 含非管理员主人、角色行、普通消息不回复。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import {
	assertCharReplyRowContract,
	assertOnMessageEventShape,
	eventMentionsChar,
} from '../../../chat/test/bridgeContract.mjs'
import { createCharBoot, waitUntil } from '../../../chat/test/harness.mjs'

const CHAR = 'gentian_shell_contract'
const BOT_ID = 900001
const BOT_USERNAME = 'MockTgBot'
const OWNER_ID = 42424201

/**
 * @param {object} [options] 选项
 * @returns {{ bot: object, sent: object[], emit: Function }} mock Telegraf
 */
function createFakeTelegraf(options = {}) {
	/** @type {Map<string, Function[]>} */
	const handlers = new Map()
	/** @type {object[]} */
	const sent = []
	const ownerId = options.ownerId || OWNER_ID
	/** @type {Map<string, object>} */
	const memberStatus = options.memberStatus || new Map([
		[String(ownerId), { status: 'member', user: { id: ownerId, first_name: 'Owner', username: 'owner' } }],
	])

	const telegram = {
		/**
		 * @returns {Promise<object>} bot 身份
		 */
		getMe: async () => ({ id: BOT_ID, is_bot: true, username: BOT_USERNAME, first_name: 'Mock' }),
		/**
		 * @param {string | number} chatId chat
		 * @param {string} text 正文
		 * @param {object} [extra] 额外选项
		 * @returns {Promise<{ message_id: number }>} 假消息
		 */
		sendMessage: async (chatId, text, extra = {}) => {
			const message_id = sent.length + 1
			sent.push({ chatId, text, ...extra, message_id })
			return { message_id }
		},
		/**
		 * @returns {Promise<void>} typing
		 */
		sendChatAction: async () => { },
		/**
		 * @param {string | number} id 用户/群 id
		 * @returns {Promise<object>} 假 chat
		 */
		getChat: async id => ({
			id: Number(id) || id,
			first_name: 'Owner',
			username: 'owner',
		}),
		/**
		 * @returns {Promise<string>} 邀请
		 */
		exportChatInviteLink: async () => 'https://t.me/+invite',
		/**
		 * @returns {Promise<object[]>} 管理员
		 */
		getChatAdministrators: async () => [
			{
				user: { id: 111, first_name: 'Admin', username: 'admin' },
				status: 'administrator',
			},
		],
		/**
		 * @param {string | number} chatId 群
		 * @param {string | number} userId 用户
		 * @returns {Promise<object>} 成员
		 */
		getChatMember: async (chatId, userId) => {
			const row = memberStatus.get(String(userId))
			if (!row) throw new Error('user not found')
			return row
		},
		/**
		 * @returns {Promise<true>} leave
		 */
		leaveChat: async () => true,
		/**
		 * @returns {Promise<true>} ban
		 */
		banChatMember: async () => true,
		/**
		 * @returns {Promise<true>} unban
		 */
		unbanChatMember: async () => true,
		/**
		 * @returns {Promise<{ message_id: number }>} sticker
		 */
		sendSticker: async () => ({ message_id: 99 }),
	}

	const bot = {
		botInfo: { id: BOT_ID, is_bot: true, username: BOT_USERNAME, first_name: 'Mock' },
		telegram,
		/**
		 * @param {string} event 事件名
		 * @param {Function} handler 处理器
		 * @returns {void}
		 */
		on(event, handler) {
			const list = handlers.get(event) || []
			list.push(handler)
			handlers.set(event, list)
		},
		/**
		 * @param {Function} handler 错误处理器
		 * @returns {void}
		 */
		catch(handler) {
			void handler
		},
	}

	/**
	 * @param {string} event 事件名
	 * @param {object} context Telegraf context
	 * @returns {Promise<void>}
	 */
	async function emit(event, context) {
		for (const handler of handlers.get(event) || [])
			await handler(context)
	}

	return { bot, sent, emit }
}

/**
 * @param {object} [overrides] 覆盖
 * @returns {object} Telegraf context
 */
function makeMessageContext(overrides = {}) {
	const fromId = overrides.fromId ?? OWNER_ID
	const chatType = overrides.chatType || 'private'
	const chatId = overrides.chatId ?? (chatType === 'private' ? fromId : -100123)
	const text = overrides.text ?? 'hello'
	const entities = overrides.entities
	const message = {
		message_id: overrides.messageId || 501,
		date: Math.floor(Date.now() / 1000),
		text,
		...entities ? { entities } : {},
		chat: {
			id: chatId,
			type: chatType,
			...chatType === 'private'
				? { first_name: 'Owner', username: 'owner' }
				: { title: 'Bridge Group' },
		},
		from: {
			id: fromId,
			is_bot: false,
			first_name: overrides.firstName || 'Owner',
			username: overrides.username || 'owner',
		},
	}
	return {
		message,
		from: message.from,
		update: { message },
		telegram: null,
	}
}

/**
 * @param {string} username fount 用户
 * @returns {Promise<object>} 启动态
 */
async function bootContract(username) {
	const boot = createCharBoot({
		username,
		chars: CHAR,
		/**
		 * @param {string} user fount 用户
		 * @returns {Promise<void>}
		 */
		afterInit: async user => {
			const { loadPart } = await import('fount/server/parts_loader.mjs')
			const char = await loadPart(user, `chars/${CHAR}`)
			await char.Load?.({ username: user, router: {} })
		},
	})
	await boot.ensureServer()
	const { onMessageProbe } = await import('../../../chat/test/fixtures/probes/onMessageProbe.mjs')
	onMessageProbe.reset()
	const { loadPart } = await import('fount/server/parts_loader.mjs')
	const { createSimpleTelegramInterface } = await import('../../src/default_interface/main.mjs')
	const { ensureLocalAgentEntityHash } = await import('../../../chat/src/entity/member.mjs')
	const char = await loadPart(username, `chars/${CHAR}`)
	const iface = await createSimpleTelegramInterface(char, username, CHAR)
	const fake = createFakeTelegraf()
	const charUid = await ensureLocalAgentEntityHash(username, CHAR)
	return { char, iface, fake, probe: onMessageProbe, charUid }
}

Deno.test('telegram OnMessage contract: DM owner replies and char row uses role/uid', async () => {
	const username = `tg-dm-${crypto.randomUUID().slice(0, 8)}`
	const { iface, fake, probe, charUid } = await bootContract(username)
	await iface.BotSetup(fake.bot, { OwnerUserID: String(OWNER_ID) }, 'test-tg-bot')

	const context = makeMessageContext({ text: 'dm ping' })
	context.telegram = fake.bot.telegram
	await fake.emit('message', context)

	await waitUntil(() => fake.sent.some(row => String(row.text || '').includes('gentian_shell_contract reply')), 15000)
	assert(probe.events.length >= 1)
	assertOnMessageEventShape(probe.events[0], { platform: 'telegram', chatKind: 'dm', expectCharUid: charUid })
	assertEquals(probe.decisions.at(-1)?.isFromOwner, true)
	assertEquals(probe.decisions.at(-1)?.wantsReply, true)

	const { getVirtualBridgeSession, virtualBridgeGroupId } = await import('../../../chat/src/chat/bridge/session.mjs')
	const logs = getVirtualBridgeSession(username, virtualBridgeGroupId('telegram', OWNER_ID))?.channels.default?.logs || []
	assertCharReplyRowContract(logs, charUid)
})

Deno.test('telegram OnMessage contract: @BotUsername mention triggers reply', async () => {
	const username = `tg-at-${crypto.randomUUID().slice(0, 8)}`
	const { iface, fake, probe, charUid } = await bootContract(username)
	await iface.BotSetup(fake.bot, { OwnerUserID: String(OWNER_ID) }, 'test-tg-bot')

	const mention = `@${BOT_USERNAME}`
	const context = makeMessageContext({
		fromId: 888001,
		chatType: 'supergroup',
		chatId: -100555,
		firstName: 'Stranger',
		username: 'stranger',
		text: `${mention} hello`,
		entities: [{ type: 'mention', offset: 0, length: mention.length }],
		messageId: 777,
	})
	context.telegram = fake.bot.telegram
	await fake.emit('message', context)

	await waitUntil(() => fake.sent.some(row => String(row.text || '').includes('gentian_shell_contract reply')), 15000)
	assert(probe.events.length >= 1)
	assertOnMessageEventShape(probe.events[0], { platform: 'telegram', chatKind: 'group', expectCharUid: charUid })
	assert(eventMentionsChar(probe.events[0], charUid), '@BotUsername must rewrite to CharUid mention')
	assertEquals(probe.decisions.at(-1)?.mentionsBot, true)
	assertEquals(probe.decisions.at(-1)?.wantsReply, true)
})

Deno.test('telegram OnMessage contract: plain group message without mention does not reply', async () => {
	const username = `tg-plain-${crypto.randomUUID().slice(0, 8)}`
	const { iface, fake, probe } = await bootContract(username)
	await iface.BotSetup(fake.bot, { OwnerUserID: String(OWNER_ID) }, 'test-tg-bot')

	const context = makeMessageContext({
		fromId: 888002,
		chatType: 'supergroup',
		chatId: -100556,
		firstName: 'Stranger',
		username: 'stranger',
		text: 'just chatting',
	})
	context.telegram = fake.bot.telegram
	await fake.emit('message', context)

	await waitUntil(() => probe.events.length >= 1, 15000)
	assertEquals(probe.decisions.at(-1)?.wantsReply, false)
	assertEquals(fake.sent.length, 0)
})

Deno.test('telegram listMembers includes non-admin owner', async () => {
	const username = `tg-mem-${crypto.randomUUID().slice(0, 8)}`
	const { iface, fake } = await bootContract(username)
	await iface.BotSetup(fake.bot, { OwnerUserID: String(OWNER_ID) }, 'test-tg-bot')

	const { requireBridgeOperation } = await import('../../../chat/src/chat/bridge/operations.mjs')
	const listMembers = requireBridgeOperation(username, {
		platform: 'telegram',
		botname: 'test-tg-bot',
	}, 'listMembers')
	const members = await listMembers({ platformChatId: -100999 })
	assert(members.some(row => String(row.platformUserId) === String(OWNER_ID)), 'owner must appear in listMembers')
	assert(members.some(row => String(row.platformUserId) === '111'), 'admins still included')
})
