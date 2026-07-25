/**
 * Discord 虚拟桥接验收：mock discord.js Client + 无 AI 角色，断言平台侧收到回复。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { ChannelType, Events } from 'npm:discord.js'

import { createCharBoot, waitUntil } from '../../../chat/test/harness.mjs'

const CHAR = 'on_message_yes'

/**
 * @returns {{ values: () => IterableIterator<object>, [Symbol.iterator]: () => IterableIterator<object> }} 空附件集合
 */
function emptyAttachmentCollection() {
	const items = []
	return {
		/**
		 * @returns {IterableIterator<object>} values
		 */
		values: () => items.values(),
		/**
		 * @returns {IterableIterator<object>} iterator
		 */
		[Symbol.iterator]: () => items.values(),
	}
}

/**
 * @param {object} [options] mock 选项
 * @returns {{ client: object, sent: object[], typingCount: { n: number }, emit: Function, channelId: string, guildId: string, textChannel: object }} mock Discord
 */
function createFakeDiscordClient(options = {}) {
	/** @type {Map<string | symbol, Function[]>} */
	const handlers = new Map()
	/** @type {object[]} */
	const sent = []
	const typingCount = { n: 0 }
	const channelId = options.channelId || 'chan-1'
	const guildId = options.guildId || 'guild-1'

	const textChannel = {
		id: channelId,
		type: ChannelType.GuildText,
		/**
		 * @returns {boolean} 是否文本频道
		 */
		isTextBased: () => true,
		/**
		 * @returns {Promise<void>} typing
		 */
		sendTyping: async () => { typingCount.n++ },
		/**
		 * @param {object} payload Discord send 载荷
		 * @returns {Promise<{ id: string }>} 假消息
		 */
		send: async payload => {
			const id = `out-${sent.length + 1}`
			sent.push({ ...payload, id, channelId })
			return { id }
		},
		messages: {
			/**
			 * @returns {Promise<Map<string, object>>} 历史（空，跳过回填）
			 */
			fetch: async () => new Map(),
		},
	}

	const client = {
		user: { username: 'MockBot', id: 'bot-user' },
		channels: {
			/**
			 * @param {string} id 频道 id
			 * @returns {Promise<object | null>} 频道
			 */
			fetch: async id => String(id) === channelId || String(id) === guildId ? textChannel : null,
		},
		guilds: {
			/**
			 * @returns {Promise<object>} 假 guild
			 */
			fetch: async () => ({
				id: guildId,
				name: 'Test Guild',
				members: {
					/**
					 * @returns {Promise<Map>} 空成员
					 */
					fetch: async () => new Map(),
					/**
					 * @returns {Promise<void>} noop
					 */
					kick: async () => {},
				},
				/**
				 * @returns {Promise<void>} noop
				 */
				leave: async () => {},
				invites: {
					/**
					 * @returns {Promise<object>} 空邀请集合
					 */
					fetch: async () => ({
						/**
						 * @returns {null} 无邀请
						 */
						first: () => null,
					}),
				},
				channels: {
					cache: {
						/**
						 * @returns {object} 文本频道
						 */
						find: () => textChannel,
					},
				},
			}),
		},
		users: {
			/**
			 * @returns {Promise<object>} 假用户
			 */
			fetch: async () => ({
				/**
				 * @returns {Promise<{ id: string }>} DM
				 */
				createDM: async () => ({ id: 'dm-1' }),
			}),
		},
		/**
		 * @param {string | symbol} event 事件名
		 * @param {Function} handler 处理器
		 * @returns {void}
		 */
		on(event, handler) {
			const list = handlers.get(event) || []
			list.push(handler)
			handlers.set(event, list)
		},
		/**
		 * @param {string | symbol} event 事件名
		 * @param {Function} handler 处理器
		 * @returns {void}
		 */
		once(event, handler) {
			this.on(event, handler)
		},
	}

	/**
	 * @param {string | symbol} event 事件名
	 * @param {...unknown} args 参数
	 * @returns {Promise<void>}
	 */
	async function emit(event, ...args) {
		for (const handler of handlers.get(event) || [])
			await handler(...args)
	}

	return { client, sent, typingCount, textChannel, emit, channelId, guildId }
}

/**
 * @param {{ channelId: string, guildId: string, textChannel: object }} ctx mock 上下文
 * @returns {object} Discord Message 鸭子
 */
function makeInboundMessage(ctx) {
	const snapshots = []
	return {
		id: 'msg-1',
		content: 'hello virtual bridge',
		createdTimestamp: Date.now(),
		editedTimestamp: null,
		partial: false,
		author: {
			id: 'owner-1',
			username: 'owner',
			tag: 'owner#0001',
			bot: false,
			globalName: 'Owner',
			/**
			 * @returns {string} 头像 URL
			 */
			displayAvatarURL: () => 'https://example.com/a.png',
		},
		member: { displayName: 'Owner', partial: false },
		channel: ctx.textChannel,
		guild: { id: ctx.guildId, name: 'Test Guild', members: {} },
		guildId: ctx.guildId,
		channelId: ctx.channelId,
		attachments: emptyAttachmentCollection(),
		embeds: [],
		components: [],
		stickers: new Map(),
		messageSnapshots: {
			/**
			 * @param {(value: object) => unknown} mapFn map 回调
			 * @returns {unknown[]} mapped
			 */
			map: mapFn => snapshots.map(mapFn),
			/**
			 * @returns {IterableIterator<object>} values
			 */
			values: () => snapshots.values(),
		},
		mentions: {
			users: {
				/**
				 * @returns {IterableIterator<object>} 空
				 */
				values: () => [][Symbol.iterator](),
			},
			roles: {
				/**
				 * @returns {IterableIterator<object>} 空
				 */
				values: () => [][Symbol.iterator](),
			},
			everyone: false,
		},
		reference: null,
		poll: null,
	}
}

Deno.test('discord virtual bridge: MessageCreate → GetReply → channel.send', async () => {
	const username = `dc-virtual-${crypto.randomUUID().slice(0, 8)}`
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
	const { createSimpleDiscordInterface } = await import('../../src/default_interface/main.mjs')
	const { enumerateJoinedFederatedGroups } = await import('../../../chat/src/group/queries.mjs')
	const { resolveOperatorEntityHash } = await import('../../../chat/src/chat/lib/replica.mjs')

	const char = await loadPart(username, `chars/${CHAR}`)
	const iface = await createSimpleDiscordInterface(char, username, CHAR)
	const fake = createFakeDiscordClient()

	await iface.OnceClientReady(fake.client, { OwnerUserName: 'owner', OwnerUserID: 'owner-1' }, 'test-bot')

	const operatorHash = await resolveOperatorEntityHash(username)
	const groupsBefore = await enumerateJoinedFederatedGroups(username, operatorHash)

	await fake.emit(Events.MessageCreate, makeInboundMessage(fake))

	await waitUntil(() => fake.sent.some(row => String(row.content || '').includes('on_message_yes reply')), 15000)
	assert(onMessageProbe.replies >= 1)
	assert(onMessageProbe.events.length >= 1)

	const groupsAfter = await enumerateJoinedFederatedGroups(username, operatorHash)
	assertEquals(groupsAfter.length, groupsBefore.length, 'virtual bridge must not create real chat groups')

	const {
		getVirtualBridgeSession,
		virtualBridgeChannelId,
		virtualBridgeGroupId,
	} = await import('../../../chat/src/chat/bridge/session.mjs')
	const { notifyVirtualBridgeOutbound } = await import('../../../chat/src/chat/bridge/outbound.mjs')
	const groupId = virtualBridgeGroupId('discord', fake.guildId)
	const channelId = virtualBridgeChannelId(fake.channelId)
	const inbound = getVirtualBridgeSession(username, groupId)?.channels[channelId]?.logs
		?.find(row => row.role === 'user')
	assert(inbound?.extension?.virtualEventId, 'inbound virtual event missing')

	const before = fake.sent.length
	await notifyVirtualBridgeOutbound(username, groupId, channelId, {
		content: 'threaded reply body',
		extension: {
			virtualEventId: `vchar_reply_${Date.now().toString(36)}`,
			replyTo: { eventId: inbound.extension.virtualEventId },
		},
	}, CHAR)
	const threaded = fake.sent.slice(before)
	assert(threaded.length >= 1)
	assertEquals(threaded[0].reply?.messageReference, 'msg-1')
	assertEquals(threaded[0].reply?.failIfNotExists, false)
})
