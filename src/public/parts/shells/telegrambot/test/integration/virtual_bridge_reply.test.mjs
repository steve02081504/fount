/**
 * Telegram 虚拟桥接验收：mock Telegraf + 无 AI 角色，断言 sendMessage 出站。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { createCharBoot, waitUntil } from '../../../chat/test/harness.mjs'

const CHAR = 'on_message_yes'

/**
 * @returns {{ bot: object, sent: object[], emit: Function }} mock Telegraf
 */
function createFakeTelegraf() {
	/** @type {Map<string, Function[]>} */
	const handlers = new Map()
	/** @type {object[]} */
	const sent = []

	const telegram = {
		/**
		 * @returns {Promise<object>} bot 身份
		 */
		getMe: async () => ({ id: 900001, is_bot: true, username: 'MockTgBot', first_name: 'Mock' }),
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
		sendChatAction: async () => {},
		/**
		 * @returns {Promise<object>} 假 chat
		 */
		getChat: async () => ({ id: 4242, first_name: 'Owner', username: 'owner' }),
		/**
		 * @returns {Promise<string>} 邀请
		 */
		exportChatInviteLink: async () => 'https://t.me/+invite',
		/**
		 * @returns {Promise<object[]>} 管理员
		 */
		getChatAdministrators: async () => [],
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
		botInfo: { id: 900001, is_bot: true, username: 'MockTgBot', first_name: 'Mock' },
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
 * @param {number} ownerId 主人 TG id
 * @returns {object} Telegraf message context
 */
function makePrivateMessageContext(ownerId) {
	const message = {
		message_id: 501,
		date: Math.floor(Date.now() / 1000),
		text: 'hello virtual telegram bridge',
		chat: { id: ownerId, type: 'private', first_name: 'Owner', username: 'owner' },
		from: { id: ownerId, is_bot: false, first_name: 'Owner', username: 'owner' },
	}
	return {
		message,
		from: message.from,
		update: { message },
		telegram: null,
	}
}

Deno.test('telegram virtual bridge: message → GetReply → sendMessage', async () => {
	const username = `tg-virtual-${crypto.randomUUID().slice(0, 8)}`
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
	onMessageProbe.returnValue = true

	const { loadPart } = await import('fount/server/parts_loader.mjs')
	const { createSimpleTelegramInterface } = await import('../../src/default_interface/main.mjs')
	const { enumerateJoinedFederatedGroups } = await import('../../../chat/src/group/queries.mjs')
	const { resolveOperatorEntityHash } = await import('../../../chat/src/chat/lib/replica.mjs')

	const char = await loadPart(username, `chars/${CHAR}`)
	const iface = await createSimpleTelegramInterface(char, username, CHAR)
	const fake = createFakeTelegraf()
	const ownerId = 42424201

	await iface.BotSetup(fake.bot, { OwnerUserID: String(ownerId) }, 'test-tg-bot')

	const operatorHash = await resolveOperatorEntityHash(username)
	const groupsBefore = await enumerateJoinedFederatedGroups(username, operatorHash)

	const context = makePrivateMessageContext(ownerId)
	context.telegram = fake.bot.telegram
	await fake.emit('message', context)

	await waitUntil(() => fake.sent.some(row => String(row.text || '').includes('on_message_yes reply')), 15000)
	assert(onMessageProbe.replies >= 1)

	const groupsAfter = await enumerateJoinedFederatedGroups(username, operatorHash)
	assert(groupsAfter.length === groupsBefore.length, 'virtual bridge must not create real chat groups')

	const {
		getVirtualBridgeSession,
		virtualBridgeGroupId,
	} = await import('../../../chat/src/chat/bridge/session.mjs')
	const { notifyVirtualBridgeOutbound } = await import('../../../chat/src/chat/bridge/outbound.mjs')
	const groupId = virtualBridgeGroupId('telegram', ownerId)
	const channelId = 'default'
	const inbound = getVirtualBridgeSession(username, groupId)?.channels[channelId]?.logs
		?.find(row => row.role === 'user')
	assert(inbound?.extension?.chat?.virtualEventId, 'inbound virtual event missing')

	const before = fake.sent.length
	await notifyVirtualBridgeOutbound(username, groupId, channelId, {
		content: 'threaded reply body',
		extension: {
			chat: {
				virtualEventId: `vchar_reply_${Date.now().toString(36)}`,
				replyTo: { eventId: inbound.extension.chat.virtualEventId },
			},
		},
	}, CHAR)
	const threaded = fake.sent.slice(before)
	assert(threaded.length >= 1)
	assertEquals(threaded[0].reply_parameters?.message_id, 501)
	assertEquals(threaded[0].reply_parameters?.allow_sending_without_reply, true)
})
