/**
 * M5：bridge ingress 集成测试。
 */
/* global Deno */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createIntegrationBoot } from '../harness.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const CHAR_YES = 'on_message_yes'

/**
 * @param {string} dataDir 数据根
 * @param {string} username 用户
 * @returns {Promise<void>}
 */
async function seedCharFixture(dataDir, username) {
	const userRoot = join(dataDir, 'users', username)
	const from = join(fixturesRoot, 'chars', CHAR_YES)
	const to = join(userRoot, 'chars', CHAR_YES)
	await mkdir(dirname(to), { recursive: true })
	await cp(from, to, { recursive: true })
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
		text: `hello @[hash:${operatorHash}]`,
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
	assertEquals(out, `ping @[hash:${hash}]`)

	const boundHash = await resolveBridgeIdentity(username, 'telegram', 77, 'Zed')
	const restored = await buildTelegramTextAndEntities(username, `see @[hash:${boundHash}]`)
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
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/server/p2p_server/operator_identity.mjs')
			await ensureOperatorPubKey(user)
			await seedCharFixture(dataDir, user)
		},
	})
	await ensureServer()

	const { registerBridgeOutbound } = await import('../../src/chat/bridge/outbound.mjs')
	const { ensureBridgeGroup } = await import('../../src/chat/bridge/registry.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { agentEntityHash } = await import('../../src/chat/lib/entity.mjs')
	const { getNodeHash } = await import('npm:@steve02081504/fount-p2p/node/identity')
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

	const agentHash = agentEntityHash(getNodeHash(), `chars/${CHAR_YES}`).toLowerCase()
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
	registerBridgeOps('telegram', {
		sendTyping: async () => { calls.push('typing') },
		createInvite: async () => {
			calls.push('invite')
			return 'https://t.me/+invite'
		},
	})

	await postBridgeMessage(username, {
		platform: 'telegram',
		platformChatId: 700003,
		platformMessageId: 31,
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
	assertEquals(out, `see @[hash:${hash}]`)
})
