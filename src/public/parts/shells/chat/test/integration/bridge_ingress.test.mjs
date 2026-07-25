/**
 * 虚拟 bridge 入站 / 出站 / 触发集成测试。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	createCharBoot,
	createIntegrationBoot,
	waitUntil,
} from '../harness.mjs'

const CHAR_YES = 'on_message_yes'
const CHAR_PLAIN_A = 'write_path_agent'
const CHAR_PLAIN_B = 'plain_reply_b'

/**
 * @param {string} prefix 用户名前缀
 * @param {object} [bootOpts] createIntegrationBoot 额外选项
 * @returns {Promise<{ username: string } & ReturnType<typeof createIntegrationBoot>>} 已启动的 boot
 */
async function bootBridge(prefix, bootOpts = {}) {
	const username = `${prefix}-${crypto.randomUUID().slice(0, 8)}`
	const boot = createIntegrationBoot({ username, minP2pNode: true, ...bootOpts })
	await boot.ensureServer()
	return { username, ...boot }
}

Deno.test('postBridgeMessage writes virtual log (no real group)', async () => {
	const { username } = await bootBridge('bridge')

	const { postBridgeMessage } = await import('../../src/chat/bridge/interfaceKit.mjs')
	const { getVirtualBridgeSession } = await import('../../src/chat/bridge/session.mjs')
	const { enumerateJoinedFederatedGroups } = await import('../../src/group/queries.mjs')
	const { resolveOperatorEntityHash } = await import('../../src/chat/lib/replica.mjs')

	const operatorHash = (await resolveOperatorEntityHash(username))?.toLowerCase()
	assert(operatorHash)

	const event = await postBridgeMessage(username, {
		platform: 'telegram',
		platformChatId: 900001,
		chatKind: 'group',
		platformMessageId: 11,
		author: { platformUserId: 424242, displayName: 'BridgeUser' },
		text: `hello @[entity:${operatorHash}]`,
		timestamp: Date.now(),
	})

	const session = getVirtualBridgeSession(username, event.groupId)
	assert(session)
	assert(session.channels.default.logs.some(row => row.extension?.virtualEventId === event.id))
	assert(String(event.groupId).startsWith('bridge:'))

	const realGroups = await enumerateJoinedFederatedGroups(username, operatorHash)
	assertEquals(realGroups.filter(row => row.groupId === event.groupId).length, 0)
})

Deno.test('bridge identity: stable hash and bind overrides', async () => {
	const { username } = await bootBridge('bridge-id')

	const {
		bridgeEntityHash,
		bindBridgeIdentity,
		resolveBridgeIdentity,
	} = await import('../../src/chat/bridge/identity.mjs')
	const { resolveOperatorEntityHash } = await import('../../src/chat/lib/replica.mjs')

	const operatorHash = (await resolveOperatorEntityHash(username))?.toLowerCase()
	assert(operatorHash)

	const a = bridgeEntityHash('telegram', 1001)
	const b = bridgeEntityHash('telegram', 1001)
	assertEquals(a, b)

	const derived = await resolveBridgeIdentity(username, 'telegram', 1001, 'TG User')
	assertEquals(derived, a)

	await bindBridgeIdentity(username, {
		platform: 'telegram',
		platformUserId: 1001,
		entityHash: operatorHash,
		displayName: 'Bound',
	})
	const bound = await resolveBridgeIdentity(username, 'telegram', 1001, 'TG User')
	assertEquals(bound, operatorHash)
})

Deno.test('rewriteTelegramMentionsToFount and outbound entity restore', async () => {
	const { username } = await bootBridge('bridge-fmt')

	const { bridgeEntityHash, resolveBridgeIdentity } = await import('../../src/chat/bridge/identity.mjs')
	const { rewriteTelegramMentionsToFount, buildTelegramTextAndEntities } = await import('../../../telegrambot/src/format.mjs')

	const hash = bridgeEntityHash('telegram', 42)
	const text = 'ping @Alice'
	const entities = [{
		type: 'text_mention',
		offset: 5,
		length: 6,
		user: { id: 42, is_bot: false, first_name: 'Alice' },
	}]
	const out = await rewriteTelegramMentionsToFount(username, text, entities)
	assertEquals(out, `ping @[entity:${hash}]`)

	const boundHash = await resolveBridgeIdentity(username, 'telegram', 77, 'Zed')
	const restored = await buildTelegramTextAndEntities(username, `see @[entity:${boundHash}]`)
	assertEquals(restored.text, 'see Zed')
	assertEquals(restored.entities.length, 1)
	assertEquals(restored.entities[0].user.id, 77)
})

Deno.test('virtual channel.send notifies bridge outbound', async () => {
	const username = `bridge-out-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createCharBoot({ username, chars: CHAR_YES })
	await ensureServer()

	const { registerBridgeOutbound } = await import('../../src/chat/bridge/outbound.mjs')
	const { ensureVirtualBridgeSession } = await import('../../src/chat/bridge/session.mjs')
	const { ensureLocalAgentEntityHash } = await import('../../src/entity/member.mjs')
	const { getChatClient } = await import('../../src/api/client/index.mjs')

	const session = ensureVirtualBridgeSession(username, {
		platform: 'telegram',
		platformChatId: 800002,
		chatKind: 'dm',
		name: 'tg-dm',
		charname: CHAR_YES,
		botname: 'out-bot',
	})
	const agentHash = (await ensureLocalAgentEntityHash(username, CHAR_YES)).toLowerCase()
	/** @type {object[]} */
	const outboundLines = []
	registerBridgeOutbound(username, session.groupId, async ({ messageLine }) => {
		outboundLines.push(messageLine)
		return { platformMessageId: 999 }
	})

	const client = await getChatClient(username, agentHash)
	const group = await client.group(session.groupId)
	const channel = await group.channel('default')
	await channel.send('bridge outbound ping')

	await waitUntil(async () => outboundLines.some(row => row.charId === CHAR_YES))
})

Deno.test('mock bridgeOperations: typing and createInvite on virtual bridge group', async () => {
	const { username } = await bootBridge('bridge-ops')

	const { registerBridgeOperations } = await import('../../src/chat/bridge/operations.mjs')
	const { ensureVirtualBridgeSession } = await import('../../src/chat/bridge/session.mjs')
	const { getChatClient } = await import('../../src/api/client/index.mjs')

	/** @type {string[]} */
	const calls = []
	registerBridgeOperations(username, 'telegram', 'ops-bot', {
		/** @returns {Promise<void>} noop */
		sendTyping: async () => { calls.push('typing') },
		/** @returns {Promise<string>} invite URL */
		createInvite: async () => {
			calls.push('invite')
			return 'https://t.me/+invite'
		},
	})

	const session = ensureVirtualBridgeSession(username, {
		platform: 'telegram',
		platformChatId: 700003,
		botname: 'ops-bot',
	})

	const client = await getChatClient(username)
	const group = await client.group(session.groupId)
	const channel = await group.defaultChannel()
	await channel.typing()
	const invite = await group.createInvite()
	assertEquals(invite, 'https://t.me/+invite')
	assert(calls.includes('typing'))
	assert(calls.includes('invite'))
})

Deno.test('discord synthetic DTO writes thread channel; lookupBridgePlatformChannel resolves', async () => {
	const { username } = await bootBridge('bridge-dc')

	const { postBridgeMessage } = await import('../../src/chat/bridge/interfaceKit.mjs')
	const { lookupBridgePlatformChannel, resolveBridgeChannel } = await import('../../src/chat/bridge/registry.mjs')
	const { getVirtualBridgeSession } = await import('../../src/chat/bridge/session.mjs')

	const guildId = '900100'
	const discordChannelId = '900101'
	const event = await postBridgeMessage(username, {
		platform: 'discord',
		platformChatId: guildId,
		platformThreadId: discordChannelId,
		platformMessageId: 'dc-message-1',
		chatKind: 'group',
		chatName: 'Test Guild',
		author: { platformUserId: '111', displayName: 'Alice' },
		text: 'discord bridge hello',
		timestamp: Date.now(),
	})

	const session = getVirtualBridgeSession(username, event.groupId)
	assert(session)
	assert(session.channels[discordChannelId]?.logs.some(row => row.extension?.virtualEventId === event.id))

	const resolved = lookupBridgePlatformChannel(username, event.groupId, 'default')
	assertEquals(resolved?.platformChatId, guildId)

	const { channelId: fountThreadChannelId } = await resolveBridgeChannel(username, {
		platform: 'discord',
		platformChatId: guildId,
		platformThreadId: discordChannelId,
	})
	const mapped = lookupBridgePlatformChannel(username, event.groupId, fountThreadChannelId)
	assertEquals(mapped?.platformChatId, guildId)
	assertEquals(mapped?.platformThreadId, discordChannelId)
})

Deno.test('wechat synthetic DTO writes virtual DM log', async () => {
	const { username } = await bootBridge('bridge-wx')

	const { postBridgeMessage } = await import('../../src/chat/bridge/interfaceKit.mjs')
	const { getVirtualBridgeSession } = await import('../../src/chat/bridge/session.mjs')

	const peerId = 'wx-peer-001'
	const event = await postBridgeMessage(username, {
		platform: 'wechat',
		platformChatId: peerId,
		platformMessageId: 'wx-message-1',
		chatKind: 'dm',
		chatName: 'WeChat DM',
		author: { platformUserId: peerId, displayName: 'Owner' },
		text: 'wechat bridge ping',
		timestamp: Date.now(),
	})

	const session = getVirtualBridgeSession(username, event.groupId)
	assert(session)
	assertEquals(session.chatKind, 'dm')
	assert(session.channels.default.logs.some(row => row.extension?.virtualEventId === event.id))
})

Deno.test('rewriteDiscordMentionsToFount in discordbot format module', async () => {
	const { username } = await bootBridge('bridge-dcfmt')

	const { bridgeEntityHash } = await import('../../src/chat/bridge/identity.mjs')
	const { rewriteDiscordMentionsToFount } = await import('../../../discordbot/src/format.mjs')
	const hash = bridgeEntityHash('discord', '555')
	const out = await rewriteDiscordMentionsToFount(username, 'see <@555>')
	assertEquals(out, `see @[entity:${hash}]`)
})

Deno.test('bridgeIngestDto DM triggers plain char GetReply → outbound', async () => {
	const username = `bridge-dm-trig-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createCharBoot({ username, chars: CHAR_PLAIN_B })
	await ensureServer()

	const { bridgeIngestDto } = await import('../../src/chat/bridge/interfaceKit.mjs')
	const { registerBridgeOutbound } = await import('../../src/chat/bridge/outbound.mjs')
	const { getVirtualBridgeSession } = await import('../../src/chat/bridge/session.mjs')
	const { loadPart } = await import('fount/server/parts_loader.mjs')

	const platformChatId = 910001
	const charAPI = await loadPart(username, `chars/${CHAR_PLAIN_B}`)
	/** @type {object[]} */
	const outboundLines = []
	/** @type {string | undefined} */
	let groupId
	await bridgeIngestDto(username, charAPI, 'telegram', {
		platform: 'telegram',
		platformChatId,
		chatKind: 'dm',
		platformMessageId: 501,
		author: { platformUserId: 4242, displayName: 'Peer' },
		text: 'dm ping without mention',
		timestamp: Date.now(),
	}, async gid => {
		groupId = gid
		registerBridgeOutbound(username, gid, async ({ messageLine }) => {
			outboundLines.push(messageLine)
			return { platformMessageId: 42 }
		})
	}, 'dm-bot', CHAR_PLAIN_B)

	await waitUntil(() => outboundLines.some(row =>
		String(row.content?.content || '').includes('plain_reply_b reply'),
	), 15000)
	const session = getVirtualBridgeSession(username, groupId)
	assert(session.channels.default.logs.some(row =>
		row.role === 'char' && String(row.content || '').includes('plain_reply_b reply'),
	))
})

Deno.test('bridgeIngestDto group does not fallback-trigger chars without OnMessage', async () => {
	const username = `bridge-grp-trig-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createCharBoot({ username, chars: CHAR_PLAIN_A })
	await ensureServer()

	const { bridgeIngestDto } = await import('../../src/chat/bridge/interfaceKit.mjs')
	const { registerBridgeOutbound } = await import('../../src/chat/bridge/outbound.mjs')
	const { getVirtualBridgeSession } = await import('../../src/chat/bridge/session.mjs')
	const { loadPart } = await import('fount/server/parts_loader.mjs')

	const platformChatId = 910002
	const charAPI = await loadPart(username, `chars/${CHAR_PLAIN_A}`)
	/** @type {object[]} */
	const outboundLines = []
	/** @type {string | undefined} */
	let groupId
	await bridgeIngestDto(username, charAPI, 'telegram', {
		platform: 'telegram',
		platformChatId,
		chatKind: 'group',
		platformMessageId: 502,
		author: { platformUserId: 4243, displayName: 'Member' },
		text: 'group ping without mention',
		timestamp: Date.now(),
	}, async gid => {
		groupId = gid
		registerBridgeOutbound(username, gid, async ({ messageLine }) => {
			outboundLines.push(messageLine)
			return {}
		})
	}, 'grp-bot', CHAR_PLAIN_A)

	await new Promise(resolve => setTimeout(resolve, 800))
	assertEquals(outboundLines.length, 0)
	const session = getVirtualBridgeSession(username, groupId)
	assert(!session.channels.default.logs.some(row => row.role === 'char'))
})

Deno.test('postBridgeEdit / postBridgeDelete mutate virtual log', async () => {
	const { username } = await bootBridge('bridge-mut')

	const { postBridgeMessage, postBridgeEdit, postBridgeDelete } = await import('../../src/chat/bridge/interfaceKit.mjs')
	const { getVirtualBridgeSession } = await import('../../src/chat/bridge/session.mjs')

	const platformChatId = 920001
	const platformMessageId = 601
	const author = { platformUserId: 7001, displayName: 'Editor' }
	const event = await postBridgeMessage(username, {
		platform: 'telegram',
		platformChatId,
		chatKind: 'group',
		platformMessageId,
		author,
		text: 'hello original',
		timestamp: Date.now(),
	})

	await postBridgeEdit(username, {
		platform: 'telegram',
		platformChatId,
		platformMessageId,
		author,
		text: 'edited ping',
		timestamp: Date.now(),
	})

	let session = getVirtualBridgeSession(username, event.groupId)
	const edited = session.channels.default.logs.find(row => row.extension?.virtualEventId === event.id)
	assert(edited)
	assertEquals(edited.content, 'edited ping')

	await postBridgeDelete(username, {
		platform: 'telegram',
		platformChatId,
		platformMessageId,
	})
	session = getVirtualBridgeSession(username, event.groupId)
	assert(!session.channels.default.logs.some(row => row.extension?.virtualEventId === event.id))
})

Deno.test('full chain: bridgeIngestDto → GetReply → notifyBridgeOutbound', async () => {
	const username = `bridge-chain-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createCharBoot({ username, chars: CHAR_PLAIN_B })
	await ensureServer()

	const { bridgeIngestDto } = await import('../../src/chat/bridge/interfaceKit.mjs')
	const { registerBridgeOutbound } = await import('../../src/chat/bridge/outbound.mjs')
	const { loadPart } = await import('fount/server/parts_loader.mjs')

	const platformChatId = 930001
	const charAPI = await loadPart(username, `chars/${CHAR_PLAIN_B}`)
	/** @type {object[]} */
	const outboundLines = []
	await bridgeIngestDto(username, charAPI, 'telegram', {
		platform: 'telegram',
		platformChatId,
		chatKind: 'dm',
		platformMessageId: 701,
		author: { platformUserId: 9001, displayName: 'Peer' },
		text: 'trigger full chain',
		timestamp: Date.now(),
	}, async gid => {
		registerBridgeOutbound(username, gid, async ({ messageLine }) => {
			outboundLines.push(messageLine)
			return { platformMessageId: 4242 }
		})
	}, 'chain-bot', CHAR_PLAIN_B)

	await waitUntil(() => outboundLines.some(row =>
		row.charId === CHAR_PLAIN_B
		|| String(row.content?.content || '').includes('plain_reply_b reply'),
	), 15000)
})

Deno.test('replyToPlatformMessageId resolves on virtual log; codeBridgeContext reads meta', async () => {
	const username = `bridge-reply-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createCharBoot({ username, chars: CHAR_PLAIN_B })
	await ensureServer()

	const { postBridgeMessage } = await import('../../src/chat/bridge/interfaceKit.mjs')
	const { getVirtualBridgeSession } = await import('../../src/chat/bridge/session.mjs')
	const { buildVirtualBridgeChatRequest } = await import('../../src/chat/bridge/request.mjs')
	const {
		bridgeMetaFromChatLogEntry,
		findTriggerChatLogEntry,
	} = await import('../../src/chat/lib/codeBridgeContext.mjs')
	const { loadPart } = await import('fount/server/parts_loader.mjs')

	const platformChatId = 960001
	const author = { platformUserId: 9101, displayName: 'Quoter' }
	const first = await postBridgeMessage(username, {
		platform: 'telegram',
		platformChatId,
		chatKind: 'group',
		platformMessageId: 901,
		author,
		text: 'original message',
		timestamp: Date.now(),
	})
	await postBridgeMessage(username, {
		platform: 'telegram',
		platformChatId,
		chatKind: 'group',
		platformMessageId: 902,
		author,
		text: 'quoting reply',
		replyToPlatformMessageId: 901,
		timestamp: Date.now(),
	})

	const session = getVirtualBridgeSession(username, first.groupId)
	const quoted = session.channels.default.logs.find(row => String(row.content || '').includes('quoting reply'))
	assert(quoted)
	assertEquals(quoted.extension.bridge.replyToEventId, first.id)
	assertEquals(quoted.extension.bridge.replyToPlatformMessageId, '901')
	assertEquals(quoted.extension.replyTo?.eventId, first.id)
	assertEquals(quoted.extension.replyTo?.preview, 'original message')

	const charAPI = await loadPart(username, `chars/${CHAR_PLAIN_B}`)
	const req = await buildVirtualBridgeChatRequest(
		username, first.groupId, 'default', CHAR_PLAIN_B, charAPI, quoted,
	)
	const trigger = findTriggerChatLogEntry(req.chat_log)
	assert(trigger)
	const meta = bridgeMetaFromChatLogEntry(trigger)
	assert(meta)
	assertEquals(meta.platformMessageId, '902')
	assertEquals(meta.replyToEventId, first.id)
	assertEquals(req.extension?.bridge?.platform, 'telegram')
})

Deno.test('OnMessage yes char: bridgeIngestDto group triggers outbound', async () => {
	const username = `bridge-onmsg-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createCharBoot({ username, chars: CHAR_YES })
	await ensureServer()

	const { onMessageProbe } = await import('../fixtures/probes/onMessageProbe.mjs')
	onMessageProbe.reset()
	onMessageProbe.returnValue = true

	const { bridgeIngestDto } = await import('../../src/chat/bridge/interfaceKit.mjs')
	const { registerBridgeOutbound } = await import('../../src/chat/bridge/outbound.mjs')
	const { loadPart } = await import('fount/server/parts_loader.mjs')

	const charAPI = await loadPart(username, `chars/${CHAR_YES}`)
	/** @type {object[]} */
	const outboundLines = []
	await bridgeIngestDto(username, charAPI, 'telegram', {
		platform: 'telegram',
		platformChatId: 970001,
		chatKind: 'group',
		platformMessageId: 801,
		author: { platformUserId: 9002, displayName: 'Peer' },
		text: 'onmessage group ping',
		timestamp: Date.now(),
	}, async gid => {
		registerBridgeOutbound(username, gid, async ({ messageLine }) => {
			outboundLines.push(messageLine)
			return { platformMessageId: 1 }
		})
	}, 'onmsg-bot', CHAR_YES)

	await waitUntil(() => outboundLines.some(row =>
		String(row.content?.content || '').includes('on_message_yes reply'),
	), 15000)
	assert(onMessageProbe.events.length >= 1)
})
