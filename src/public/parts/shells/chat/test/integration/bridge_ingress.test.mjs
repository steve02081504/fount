/**
 * bridge ingress 集成测试。
 */
/* global Deno */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createIntegrationBoot } from '../harness.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const CHAR_YES = 'on_message_yes'
const CHAR_PLAIN_A = 'write_path_agent'
const CHAR_PLAIN_B = 'plain_reply_b'

/**
 * @param {string} dataDir 数据根
 * @param {string} username 用户
 * @param {string | string[]} charNames 角色 fixture 名
 * @returns {Promise<void>}
 */
async function seedCharFixture(dataDir, username, charNames = CHAR_YES) {
	const userRoot = join(dataDir, 'users', username)
	for (const name of [charNames].flat()) {
		const from = join(fixturesRoot, 'chars', name)
		const to = join(userRoot, 'chars', name)
		await mkdir(dirname(to), { recursive: true })
		await cp(from, to, { recursive: true })
	}
}

/**
 * @param {() => Promise<boolean>} predicate 条件
 * @param {number} [timeoutMs] 超时
 * @returns {Promise<void>}
 */
async function waitUntil(predicate, timeoutMs = 10000) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (await predicate()) return
		await new Promise(resolve => setTimeout(resolve, 100))
	}
	throw new Error('waitUntil timeout')
}

Deno.test('postBridgeMessage persists message and mention inbox', async () => {
	const username = `bridge-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_ingress_',
		minP2pNode: true,
	})
	await ensureServer()

	const { postBridgeMessage } = await import('../../src/chat/bridge/ingress.mjs')
	const { bridgeEntityHash } = await import('../../src/chat/bridge/identity.mjs')
	const { resolveOperatorEntityHash } = await import('../../src/chat/lib/replica.mjs')
	const { listChatInbox } = await import('../../src/chat/lib/inbox.mjs')
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')

	const operatorHash = (await resolveOperatorEntityHash(username))?.toLowerCase()
	assert(operatorHash)

	const platformUserId = 424242
	const authorHash = bridgeEntityHash('telegram', platformUserId)
	const event = await postBridgeMessage(username, {
		platform: 'telegram',
		platformChatId: 900001,
		chatKind: 'group',
		platformMessageId: 11,
		author: { platformUserId, displayName: 'BridgeUser' },
		text: `hello @[entity:${operatorHash}]`,
		timestamp: Date.now(),
	})

	const { ensureBridgeGroup } = await import('../../src/chat/bridge/registry.mjs')
	const { groupId } = await ensureBridgeGroup(username, {
		platform: 'telegram',
		platformChatId: 900001,
	})
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const channelId = await getDefaultChannelId(username, groupId)
	const messages = await readChannelMessagesForUser(username, groupId, channelId, { limit: 20 })
	assert(messages.some(row => row.eventId === event.id))

	const inbox = await listChatInbox(username, operatorHash, { kinds: ['mention'] })
	assert(inbox.items.some(row => row.eventId === event.id))
})

Deno.test('bridge identity: stable hash and bind overrides', async () => {
	const username = `bridge-id-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_identity_',
		minP2pNode: true,
	})
	await ensureServer()

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
	const username = `bridge-fmt-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_fmt_',
		minP2pNode: true,
	})
	await ensureServer()

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

Deno.test('notifyBridgeOutbound on char channel.send', async () => {
	const username = `bridge-out-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_outbound_',
		minP2pNode: true,
		/** @param {string} user replica */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			await seedCharFixture(dataDir, user)
		},
	})
	await ensureServer()

	const { registerBridgeOutbound } = await import('../../src/chat/bridge/outbound.mjs')
	const { ensureBridgeGroup } = await import('../../src/chat/bridge/registry.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { ensureLocalAgentEntityHash } = await import('../../src/entity/member.mjs')
	const { getChatClient } = await import('../../src/api/index.mjs')

	const platformChatId = 800002
	const { groupId } = await ensureBridgeGroup(username, {
		platform: 'telegram',
		platformChatId,
		chatKind: 'dm',
		name: 'tg-dm',
	})
	await addchar(groupId, CHAR_YES, username)
	const channelId = await getDefaultChannelId(username, groupId)

	const agentHash = (await ensureLocalAgentEntityHash(username, CHAR_YES)).toLowerCase()
	/** @type {object[]} */
	const outboundLines = []
	registerBridgeOutbound(username, groupId, async ({ messageLine }) => {
		outboundLines.push(messageLine)
		return { platformMessageId: 999 }
	})

	const client = await getChatClient(username, agentHash)
	const group = await client.group(groupId)
	const channel = await group.channel(channelId)
	await channel.send('bridge outbound ping')

	await waitUntil(async () => outboundLines.some(row => row.charId === CHAR_YES))
})

Deno.test('mock bridgeOps: typing and createInvite on bridge group', async () => {
	const username = `bridge-ops-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_ops_',
		minP2pNode: true,
	})
	await ensureServer()

	const { registerBridgeOps } = await import('../../src/chat/bridge/ops.mjs')
	const { postBridgeMessage } = await import('../../src/chat/bridge/ingress.mjs')
	const { getChatClient } = await import('../../src/api/index.mjs')

	/** @type {string[]} */
	const calls = []
	registerBridgeOps(username, 'telegram', 'ops-bot', {
		/** @returns {Promise<void>} noop */
		sendTyping: async () => { calls.push('typing') },
		/** @returns {Promise<string>} invite URL */
		createInvite: async () => {
			calls.push('invite')
			return 'https://t.me/+invite'
		},
	})

	await postBridgeMessage(username, {
		platform: 'telegram',
		platformChatId: 700003,
		platformMessageId: 31,
		botname: 'ops-bot',
		author: { platformUserId: 1, displayName: 'u' },
		text: 'ops',
	})

	const { ensureBridgeGroup } = await import('../../src/chat/bridge/registry.mjs')
	const { groupId } = await ensureBridgeGroup(username, {
		platform: 'telegram',
		platformChatId: 700003,
	})

	const client = await getChatClient(username)
	const group = await client.group(groupId)
	const channel = await group.defaultChannel()
	await channel.typing()
	const invite = await group.createInvite()
	assertEquals(invite, 'https://t.me/+invite')
	assert(calls.includes('typing'))
	assert(calls.includes('invite'))
})

Deno.test('discord synthetic DTO persists and lookupBridgePlatformChannel resolves thread', async () => {
	const username = `bridge-dc-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_discord_',
		minP2pNode: true,
	})
	await ensureServer()

	const { postBridgeMessage } = await import('../../src/chat/bridge/ingress.mjs')
	const { lookupBridgePlatformChannel, resolveBridgeChannel } = await import('../../src/chat/bridge/registry.mjs')
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')

	const guildId = '900100'
	const discordChannelId = '900101'
	const event = await postBridgeMessage(username, {
		platform: 'discord',
		platformChatId: guildId,
		platformThreadId: discordChannelId,
		platformMessageId: 'dc-msg-1',
		chatKind: 'group',
		chatName: 'Test Guild',
		author: { platformUserId: '111', displayName: 'Alice' },
		text: 'discord bridge hello',
		timestamp: Date.now(),
	})

	const { ensureBridgeGroup } = await import('../../src/chat/bridge/registry.mjs')
	const { groupId } = await ensureBridgeGroup(username, {
		platform: 'discord',
		platformChatId: guildId,
	})
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const defaultChannelId = await getDefaultChannelId(username, groupId)
	const resolved = lookupBridgePlatformChannel(username, groupId, defaultChannelId)
	assertEquals(resolved?.platformChatId, guildId)

	const { channelId: fountThreadChannelId } = await resolveBridgeChannel(username, {
		platform: 'discord',
		platformChatId: guildId,
		platformThreadId: discordChannelId,
	})
	const mapped = lookupBridgePlatformChannel(username, groupId, fountThreadChannelId)
	assertEquals(mapped?.platformChatId, guildId)
	assertEquals(mapped?.platformThreadId, discordChannelId)

	const messages = await readChannelMessagesForUser(username, groupId, fountThreadChannelId, { limit: 10 })
	assert(messages.some(row => row.eventId === event.id))
})

Deno.test('wechat synthetic DTO persists to DAG', async () => {
	const username = `bridge-wx-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_wechat_',
		minP2pNode: true,
	})
	await ensureServer()

	const { postBridgeMessage } = await import('../../src/chat/bridge/ingress.mjs')
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')

	const peerId = 'wx-peer-001'
	const event = await postBridgeMessage(username, {
		platform: 'wechat',
		platformChatId: peerId,
		platformMessageId: 'wx-msg-1',
		chatKind: 'dm',
		chatName: 'WeChat DM',
		author: { platformUserId: peerId, displayName: 'Owner' },
		text: 'wechat bridge ping',
		timestamp: Date.now(),
	})

	const { ensureBridgeGroup } = await import('../../src/chat/bridge/registry.mjs')
	const { groupId } = await ensureBridgeGroup(username, {
		platform: 'wechat',
		platformChatId: peerId,
		chatKind: 'dm',
	})
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const channelId = await getDefaultChannelId(username, groupId)
	const messages = await readChannelMessagesForUser(username, groupId, channelId, { limit: 10 })
	assert(messages.some(row => row.eventId === event.id))
})

Deno.test('rewriteDiscordMentionsToFount in discordbot format module', async () => {
	const username = `bridge-dcfmt-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_dcfmt_',
		minP2pNode: true,
	})
	await ensureServer()

	const { bridgeEntityHash } = await import('../../src/chat/bridge/identity.mjs')
	const { rewriteDiscordMentionsToFount } = await import('../../../discordbot/src/format.mjs')
	const hash = bridgeEntityHash('discord', '555')
	const out = await rewriteDiscordMentionsToFount(username, 'see <@555>')
	assertEquals(out, `see @[entity:${hash}]`)
})

Deno.test('bridge DM fallback triggers char without OnMessage when charCount > 1', async () => {
	const username = `bridge-dm-trig-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_dm_trig_',
		minP2pNode: true,
		/** @param {string} user replica */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			await seedCharFixture(dataDir, user, [CHAR_PLAIN_A, CHAR_PLAIN_B])
		},
	})
	await ensureServer()

	const { postBridgeMessage } = await import('../../src/chat/bridge/ingress.mjs')
	const { ensureBridgeGroup } = await import('../../src/chat/bridge/registry.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')

	const platformChatId = 910001
	const { groupId } = await ensureBridgeGroup(username, {
		platform: 'telegram',
		platformChatId,
		chatKind: 'dm',
		name: 'tg-dm-trigger',
	})
	await addchar(groupId, CHAR_PLAIN_A, username)
	await addchar(groupId, CHAR_PLAIN_B, username)
	const channelId = await getDefaultChannelId(username, groupId)

	await postBridgeMessage(username, {
		platform: 'telegram',
		platformChatId,
		chatKind: 'dm',
		platformMessageId: 501,
		author: { platformUserId: 4242, displayName: 'Peer' },
		text: 'dm ping without mention',
		timestamp: Date.now(),
	})

	const replyMarkers = ['write_path_agent reply', 'plain_reply_b reply']
	await waitUntil(async () => {
		const messages = await readChannelMessagesForUser(username, groupId, channelId, { limit: 20 })
		return messages.some(row => replyMarkers.some(marker => String(row.content?.content || '').includes(marker)))
	}, 15000)
})

Deno.test('bridge group without DM does not fallback-trigger chars without OnMessage', async () => {
	const username = `bridge-grp-trig-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_grp_trig_',
		minP2pNode: true,
		/** @param {string} user replica */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			await seedCharFixture(dataDir, user, [CHAR_PLAIN_A, CHAR_PLAIN_B])
		},
	})
	await ensureServer()

	const { postBridgeMessage } = await import('../../src/chat/bridge/ingress.mjs')
	const { ensureBridgeGroup } = await import('../../src/chat/bridge/registry.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')

	const platformChatId = 910002
	const { groupId } = await ensureBridgeGroup(username, {
		platform: 'telegram',
		platformChatId,
		chatKind: 'group',
		name: 'tg-group-no-trigger',
	})
	await addchar(groupId, CHAR_PLAIN_A, username)
	await addchar(groupId, CHAR_PLAIN_B, username)
	const channelId = await getDefaultChannelId(username, groupId)

	await postBridgeMessage(username, {
		platform: 'telegram',
		platformChatId,
		chatKind: 'group',
		platformMessageId: 502,
		author: { platformUserId: 4243, displayName: 'Member' },
		text: 'group ping without mention',
		timestamp: Date.now(),
	})

	await new Promise(resolve => setTimeout(resolve, 500))
	const messages = await readChannelMessagesForUser(username, groupId, channelId, { limit: 20 })
	const replyMarkers = ['write_path_agent reply', 'plain_reply_b reply']
	assert(!messages.some(row => replyMarkers.some(marker => String(row.content?.content || '').includes(marker))))
})

Deno.test('postBridgeEdit updates content and mention inbox', async () => {
	const username = `bridge-edit-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_edit_',
		minP2pNode: true,
	})
	await ensureServer()

	const { postBridgeMessage, postBridgeEdit } = await import('../../src/chat/bridge/ingress.mjs')
	const { ensureBridgeGroup } = await import('../../src/chat/bridge/registry.mjs')
	const { resolveOperatorEntityHash } = await import('../../src/chat/lib/replica.mjs')
	const { listChatInbox } = await import('../../src/chat/lib/inbox.mjs')
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')

	const operatorHash = (await resolveOperatorEntityHash(username))?.toLowerCase()
	assert(operatorHash)

	const platformChatId = 920001
	const platformMessageId = 601
	const author = { platformUserId: 7001, displayName: 'Editor' }
	const event = await postBridgeMessage(username, {
		platform: 'telegram',
		platformChatId,
		chatKind: 'group',
		platformMessageId,
		author,
		text: `hello @[entity:${operatorHash}]`,
		timestamp: Date.now(),
	})

	const { groupId } = await ensureBridgeGroup(username, { platform: 'telegram', platformChatId })
	const channelId = await getDefaultChannelId(username, groupId)
	const inboxBefore = await listChatInbox(username, operatorHash, { kinds: ['mention'] })
	assert(inboxBefore.items.some(row => row.eventId === event.id))

	await postBridgeEdit(username, {
		platform: 'telegram',
		platformChatId,
		platformMessageId,
		author,
		text: `edited @[entity:${operatorHash}] ping`,
		timestamp: Date.now(),
	})

	const messages = await readChannelMessagesForUser(username, groupId, channelId, { limit: 20 })
	const row = messages.find(m => m.eventId === event.id)
	assert(row)
	assert(String(row.content?.content || '').includes('edited'))
	assert(String(row.content?.content || '').includes(`@[entity:${operatorHash}]`))

	await waitUntil(async () => {
		const inbox = await listChatInbox(username, operatorHash, { kinds: ['mention'] })
		return inbox.items.some(item =>
			item.eventId === event.id && String(item.textPreview || '').includes('edited'),
		)
	})
})

Deno.test('postBridgeDelete removes message from channel display', async () => {
	const username = `bridge-del-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_del_',
		minP2pNode: true,
	})
	await ensureServer()

	const { postBridgeMessage, postBridgeDelete } = await import('../../src/chat/bridge/ingress.mjs')
	const { ensureBridgeGroup } = await import('../../src/chat/bridge/registry.mjs')
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')

	const platformChatId = 920002
	const platformMessageId = 602
	const event = await postBridgeMessage(username, {
		platform: 'discord',
		platformChatId,
		platformMessageId,
		chatKind: 'group',
		author: { platformUserId: '8001', displayName: 'Deleter' },
		text: 'delete me soon',
		timestamp: Date.now(),
	})

	const { groupId } = await ensureBridgeGroup(username, { platform: 'discord', platformChatId })
	const channelId = await getDefaultChannelId(username, groupId)
	assert((await readChannelMessagesForUser(username, groupId, channelId, { limit: 20 }))
		.some(row => row.eventId === event.id))

	await postBridgeDelete(username, {
		platform: 'discord',
		platformChatId,
		platformMessageId,
	})

	const after = await readChannelMessagesForUser(username, groupId, channelId, { limit: 20 })
	assert(!after.some(row => row.eventId === event.id))
})

Deno.test('full chain: bridgeIngestDto auto addchar → GetReply → notifyBridgeOutbound', async () => {
	const username = `bridge-chain-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_chain_',
		minP2pNode: true,
		/** @param {string} user replica */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			await seedCharFixture(dataDir, user, CHAR_PLAIN_B)
		},
	})
	await ensureServer()

	const { bridgeIngestDto } = await import('../../src/chat/bridge/interfaceKit.mjs')
	const { registerBridgeOutbound } = await import('../../src/chat/bridge/outbound.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')
	const { loadPart } = await import('fount/server/parts_loader.mjs')

	const platformChatId = 930001
	const charAPI = await loadPart(username, `chars/${CHAR_PLAIN_B}`)
	/** @type {string | undefined} */
	let groupId
	/** @type {object[]} */
	const outboundLines = []
	await bridgeIngestDto(username, charAPI, 'telegram', {
		platform: 'telegram',
		platformChatId,
		chatKind: 'group',
		platformMessageId: 701,
		author: { platformUserId: 9001, displayName: 'Peer' },
		text: 'trigger full chain',
		timestamp: Date.now(),
	}, async gid => {
		groupId = gid
		registerBridgeOutbound(username, gid, async ({ messageLine }) => {
			outboundLines.push(messageLine)
			return { platformMessageId: 4242 }
		})
	}, 'chain-bot', CHAR_PLAIN_B)

	const channelId = await getDefaultChannelId(username, groupId)
	await waitUntil(async () => {
		const messages = await readChannelMessagesForUser(username, groupId, channelId, { limit: 20 })
		return messages.some(row => String(row.content?.content || '').includes('plain_reply_b reply'))
	}, 15000)

	await waitUntil(() => outboundLines.some(row =>
		row.charId === CHAR_PLAIN_B
		|| String(row.content?.content || '').includes('plain_reply_b reply'),
	), 15000)
})

Deno.test('replyToPlatformMessageId resolves to extension.bridge.replyToEventId; codeBridgeContext reads hydrated meta', async () => {
	const username = `bridge-reply-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_reply_',
		minP2pNode: true,
		/** @param {string} user replica */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			await seedCharFixture(dataDir, user, CHAR_PLAIN_B)
		},
	})
	await ensureServer()

	const { postBridgeMessage } = await import('../../src/chat/bridge/ingress.mjs')
	const { ensureBridgeGroup } = await import('../../src/chat/bridge/registry.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')
	const { getChatRequest } = await import('../../src/chat/session/chatRequest.mjs')
	const {
		bridgeMetaFromChatLogEntry,
		findTriggerChatLogEntry,
	} = await import('../../src/chat/lib/codeBridgeContext.mjs')

	const platformChatId = 960001
	const { groupId } = await ensureBridgeGroup(username, {
		platform: 'telegram',
		platformChatId,
		chatKind: 'group',
		name: 'reply-chain',
	})
	await addchar(groupId, CHAR_PLAIN_B, username)
	const channelId = await getDefaultChannelId(username, groupId)

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

	const messages = await readChannelMessagesForUser(username, groupId, channelId, { limit: 10 })
	const quoted = messages.find(row => String(row.content?.content || '').includes('quoting reply'))
	assert(quoted)
	assertEquals(quoted.content.extension.bridge.replyToEventId, first.id)
	assertEquals(quoted.content.extension.bridge.replyToPlatformMessageId, '901')

	// 水合后 chat_log 行上 bridge 元数据在 entry.extension.bridge，codeBridgeContext 必须能读到
	const req = await getChatRequest(groupId, CHAR_PLAIN_B, channelId, { replicaUsername: username })
	const trigger = findTriggerChatLogEntry(req.chat_log)
	assert(trigger)
	const meta = bridgeMetaFromChatLogEntry(trigger)
	assert(meta)
	assertEquals(meta.platformMessageId, '902')
	assertEquals(meta.replyToEventId, first.id)
})

Deno.test('getChatRequest exposes extension.bridge on bridge groups', async () => {
	const username = `bridge-ext-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_ext_',
		minP2pNode: true,
		/** @param {string} user replica */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			await seedCharFixture(dataDir, user, CHAR_PLAIN_B)
		},
	})
	await ensureServer()

	const { ensureBridgeGroup } = await import('../../src/chat/bridge/registry.mjs')
	const { postBridgeMessage } = await import('../../src/chat/bridge/ingress.mjs')
	const { getChatRequest } = await import('../../src/chat/session/chatRequest.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')

	const platformChatId = 940001
	const { groupId } = await ensureBridgeGroup(username, {
		platform: 'telegram',
		platformChatId,
		chatKind: 'group',
		botname: 'ext-bot',
	})
	await addchar(groupId, CHAR_PLAIN_B, username)
	await postBridgeMessage(username, {
		platform: 'telegram',
		platformChatId,
		chatKind: 'group',
		platformMessageId: 801,
		author: { platformUserId: 9002, displayName: 'Peer' },
		text: 'bridge extension probe',
		timestamp: Date.now(),
	})

	const req = await getChatRequest(groupId, CHAR_PLAIN_B, null, { replicaUsername: username })
	assertEquals(req.extension?.bridge?.platform, 'telegram')
	assertEquals(req.extension?.bridge?.botname, 'ext-bot')
})
