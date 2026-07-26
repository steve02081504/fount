/**
 * Discord OnMessage 契约：DM 主人直通、群内 @、角色行 role/uid、回填时序、普通消息不回复。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { ChannelType, Events } from 'npm:discord.js'

import {
	assertBackfillBeforeTrigger,
	assertCharReplyRowContract,
	assertOnMessageEventShape,
	eventMentionsChar,
} from '../../../chat/test/bridgeContract.mjs'
import { createCharBoot, waitUntil } from '../../../chat/test/harness.mjs'

const CHAR = 'gentian_shell_contract'
const BOT_USER_ID = '990000000000000001'
const OWNER_ID = '420000000000000042'
const OWNER_USERNAME = 'owner_handle'

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
 * @returns {object} mock Discord
 */
function createFakeDiscordClient(options = {}) {
	/** @type {Map<string | symbol, Function[]>} */
	const handlers = new Map()
	/** @type {object[]} */
	const sent = []
	const channelId = options.channelId || 'chan-1'
	const guildId = options.guildId || 'guild-1'
	const dmChannelId = options.dmChannelId || 'dm-chan-1'
	/** @type {Map<string, object>} */
	const historyByChannel = options.historyByChannel || new Map()

	/**
	 * @param {string} id 频道 id
	 * @param {number} [type] ChannelType
	 * @returns {object} 文本频道
	 */
	function makeTextChannel(id, type = ChannelType.GuildText) {
		return {
			id,
			type,
			/**
			 * @returns {boolean} 是否文本频道
			 */
			isTextBased: () => true,
			/**
			 * @returns {Promise<void>} typing
			 */
			sendTyping: async () => { },
			/**
			 * @param {object} payload Discord send 载荷
			 * @returns {Promise<{ id: string }>} 假消息
			 */
			send: async payload => {
				const outId = `out-${sent.length + 1}`
				sent.push({ ...payload, id: outId, channelId: id })
				return { id: outId }
			},
			messages: {
				/**
				 * @returns {Promise<Map<string, object>>} 历史
				 */
				fetch: async () => historyByChannel.get(id) || new Map(),
			},
		}
	}

	const textChannel = makeTextChannel(channelId)
	const dmChannel = makeTextChannel(dmChannelId, ChannelType.DM)

	const client = {
		user: { username: 'MockBot', id: BOT_USER_ID },
		channels: {
			/**
			 * @param {string} id 频道 id
			 * @returns {Promise<object | null>} 频道
			 */
			fetch: async id => {
				if (String(id) === channelId || String(id) === guildId) return textChannel
				if (String(id) === dmChannelId) return dmChannel
				return null
			},
		},
		guilds: {
			cache: {
				/**
				 * @returns {IterableIterator<object>} 空
				 */
				values: () => [][Symbol.iterator](),
			},
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
					kick: async () => { },
				},
				/**
				 * @returns {Promise<void>} noop
				 */
				leave: async () => { },
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
			 * @param {string} id 用户 id
			 * @returns {Promise<object>} 假用户
			 */
			fetch: async id => ({
				id: String(id),
				username: String(id) === OWNER_ID ? OWNER_USERNAME : `user_${id}`,
				globalName: String(id) === OWNER_ID ? 'Owner' : `User ${id}`,
				/**
				 * @returns {Promise<{ id: string }>} DM
				 */
				createDM: async () => ({ id: dmChannelId }),
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

	return { client, sent, textChannel, dmChannel, emit, channelId, guildId, dmChannelId, historyByChannel }
}

/**
 * @param {object} ctx mock 上下文
 * @param {object} [overrides] 覆盖字段
 * @returns {object} Discord Message 鸭子
 */
function makeInboundMessage(ctx, overrides = {}) {
	const isDm = overrides.isDm === true
	const authorId = overrides.authorId || OWNER_ID
	const authorUsername = overrides.authorUsername || OWNER_USERNAME
	const content = overrides.content ?? 'hello contract'
	const messageId = overrides.id || 'msg-1'
	const channel = isDm ? ctx.dmChannel : ctx.textChannel
	const snapshots = []
	/** @type {object[]} */
	const mentionUsers = overrides.mentionUsers || []
	return {
		id: messageId,
		content,
		createdTimestamp: overrides.createdTimestamp || Date.now(),
		editedTimestamp: null,
		partial: false,
		author: {
			id: authorId,
			username: authorUsername,
			tag: `${authorUsername}#0001`,
			bot: false,
			globalName: authorUsername,
			/**
			 * @returns {string} 头像 URL
			 */
			displayAvatarURL: () => 'https://example.com/a.png',
		},
		member: isDm ? null : { displayName: authorUsername, partial: false },
		channel,
		guild: isDm ? null : { id: ctx.guildId, name: 'Test Guild', members: {} },
		guildId: isDm ? null : ctx.guildId,
		channelId: channel.id,
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
				 * @returns {IterableIterator<object>} 提及用户
				 */
				values: () => mentionUsers[Symbol.iterator](),
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

/**
 * @param {string} username fount 用户
 * @returns {Promise<{ char: object, iface: object, fake: object, probe: object, charUid: string }>} 启动态
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
	const { createSimpleDiscordInterface } = await import('../../src/default_interface/main.mjs')
	const { ensureLocalAgentEntityHash } = await import('../../../chat/src/entity/member.mjs')
	const char = await loadPart(username, `chars/${CHAR}`)
	const iface = await createSimpleDiscordInterface(char, username, CHAR)
	const fake = createFakeDiscordClient()
	const charUid = (await ensureLocalAgentEntityHash(username, CHAR)).toLowerCase()
	return { char, iface, fake, probe: onMessageProbe, charUid }
}

Deno.test('discord OnMessage contract: DM with only OwnerUserID reaches bridge and replies', async () => {
	const username = `dc-dm-${crypto.randomUUID().slice(0, 8)}`
	const { iface, fake, probe, charUid } = await bootContract(username)
	await iface.OnceClientReady(fake.client, {
		OwnerUserName: 'your_discord_username',
		OwnerUserID: OWNER_ID,
	}, 'test-bot')

	await fake.emit(Events.MessageCreate, makeInboundMessage(fake, {
		isDm: true,
		content: 'dm ping',
		id: 'dm-msg-1',
	}))

	await waitUntil(() => fake.sent.some(row => String(row.content || '').includes('gentian_shell_contract reply')), 15000)
	assert(probe.events.length >= 1)
	assertOnMessageEventShape(probe.events[0], { platform: 'discord', chatKind: 'dm', expectCharUid: charUid })
	assertEquals(probe.decisions.at(-1)?.isFromOwner, true)
	assertEquals(probe.decisions.at(-1)?.wantsReply, true)

	const { getVirtualBridgeSession, virtualBridgeGroupId } = await import('../../../chat/src/chat/bridge/session.mjs')
	const groupId = virtualBridgeGroupId('discord', fake.dmChannelId)
	const logs = getVirtualBridgeSession(username, groupId)?.channels.default?.logs || []
	assertCharReplyRowContract(logs, charUid)
})

Deno.test('discord OnMessage contract: guild @bot triggers reply and char row uses role/uid', async () => {
	const username = `dc-at-${crypto.randomUUID().slice(0, 8)}`
	const { iface, fake, probe, charUid } = await bootContract(username)
	await iface.OnceClientReady(fake.client, {
		OwnerUserName: OWNER_USERNAME,
		OwnerUserID: OWNER_ID,
	}, 'test-bot')

	await fake.emit(Events.MessageCreate, makeInboundMessage(fake, {
		authorId: 'stranger-9',
		authorUsername: 'stranger',
		content: `<@${BOT_USER_ID}> hello bot`,
		id: 'guild-at-1',
		mentionUsers: [{ id: BOT_USER_ID, username: 'MockBot', bot: true }],
	}))

	await waitUntil(() => fake.sent.some(row => String(row.content || '').includes('gentian_shell_contract reply')), 15000)
	assert(probe.events.length >= 1)
	assertOnMessageEventShape(probe.events[0], { platform: 'discord', chatKind: 'group', expectCharUid: charUid })
	assert(eventMentionsChar(probe.events[0], charUid), 'mentions must include CharUid')
	assertEquals(probe.decisions.at(-1)?.mentionsBot, true)
	assertEquals(probe.decisions.at(-1)?.wantsReply, true)

	const { getVirtualBridgeSession, virtualBridgeGroupId, virtualBridgeChannelId } = await import('../../../chat/src/chat/bridge/session.mjs')
	const groupId = virtualBridgeGroupId('discord', fake.guildId)
	const channelId = virtualBridgeChannelId(fake.channelId)
	const logs = getVirtualBridgeSession(username, groupId)?.channels[channelId]?.logs || []
	assertCharReplyRowContract(logs, charUid)
})

Deno.test('discord OnMessage contract: plain guild message without mention does not reply', async () => {
	const username = `dc-plain-${crypto.randomUUID().slice(0, 8)}`
	const { iface, fake, probe } = await bootContract(username)
	await iface.OnceClientReady(fake.client, {
		OwnerUserName: OWNER_USERNAME,
		OwnerUserID: OWNER_ID,
	}, 'test-bot')

	await fake.emit(Events.MessageCreate, makeInboundMessage(fake, {
		authorId: 'stranger-2',
		authorUsername: 'stranger',
		content: 'just chatting',
		id: 'guild-plain-1',
	}))

	await waitUntil(() => probe.events.length >= 1, 15000)
	assertEquals(probe.decisions.at(-1)?.wantsReply, false)
	assertEquals(fake.sent.length, 0)
})

Deno.test('discord OnMessage contract: backfill precedes trigger and does not fire OnMessage', async () => {
	const username = `dc-bf-${crypto.randomUUID().slice(0, 8)}`
	const { iface, fake, probe, charUid } = await bootContract(username)

	const history = new Map()
	const oldMsg = makeInboundMessage(fake, {
		isDm: true,
		content: 'old history',
		id: 'hist-1',
		createdTimestamp: Date.now() - 60_000,
	})
	history.set('hist-1', oldMsg)
	fake.historyByChannel.set(fake.dmChannelId, history)

	await iface.OnceClientReady(fake.client, {
		OwnerUserName: OWNER_USERNAME,
		OwnerUserID: OWNER_ID,
	}, 'test-bot')

	const trigger = makeInboundMessage(fake, {
		isDm: true,
		content: 'trigger now',
		id: 'trigger-1',
		createdTimestamp: Date.now(),
	})
	await fake.emit(Events.MessageCreate, trigger)

	await waitUntil(() => fake.sent.some(row => String(row.content || '').includes('gentian_shell_contract reply')), 15000)

	assert(!probe.events.some(ev => String(ev.message?.content || '').includes('old history')))

	const { getVirtualBridgeSession, virtualBridgeGroupId } = await import('../../../chat/src/chat/bridge/session.mjs')
	const groupId = virtualBridgeGroupId('discord', fake.dmChannelId)
	const logs = getVirtualBridgeSession(username, groupId)?.channels.default?.logs || []
	assertBackfillBeforeTrigger(logs, 'trigger-1')
	assertCharReplyRowContract(logs, charUid)
})
