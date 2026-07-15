/**
 * Hub + mock TG/DC/WX 四端触发意愿一致性。
 */
/* global Deno */
import { Buffer } from 'node:buffer'
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { onMessageProbe } from '../fixtures/probes/onMessageProbe.mjs'
import { createIntegrationBoot } from '../harness.mjs'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')
const CHAR_YES = 'on_message_yes'
const CHAR_PLAIN_A = 'write_path_agent'
const CHAR_PLAIN_B = 'plain_reply_b'

/**
 * @param {string} dataDir 数据根
 * @param {string} username 用户
 * @param {string | string[]} charNames 角色 fixture 名
 * @returns {Promise<void>} 无
 */
async function seedCharFixture(dataDir, username, charNames) {
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
 * @returns {Promise<void>} 等待 predicate 成立或超时抛错
 */
async function waitUntil(predicate, timeoutMs = 15000) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (await predicate()) return
		await new Promise(resolve => setTimeout(resolve, 100))
	}
	throw new Error('waitUntil timeout')
}

/**
 * @param {string} username replica
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @returns {Promise<object[]>} 频道消息行
 */
async function listMessages(username, groupId, channelId) {
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')
	return readChannelMessagesForUser(username, groupId, channelId, { limit: 40 })
}

/**
 * @param {'hub' | 'telegram' | 'discord' | 'wechat'} end 端点
 * @param {string} username replica
 * @param {{ chatKind: 'group' | 'dm', label: string, platformChatId: string | number }} opts 会话选项
 * @returns {Promise<{ groupId: string, channelId: string, post: (text: string, platformMessageId: string | number) => Promise<void> }>} 端会话句柄
 */
async function openEnd(end, username, opts) {
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')

	if (end === 'hub') {
		if (opts.chatKind === 'dm') {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			const { randomKeyPair } = await import('npm:@steve02081504/fount-p2p/crypto')
			const { createEcdhDmGroup } = await import('../../src/chat/dm/index.mjs')
			const myPub = await ensureOperatorPubKey(username)
			const peer = await randomKeyPair()
			const peerPub = Buffer.from(peer.publicKey).toString('hex')
			const dm = await createEcdhDmGroup(username, myPub, peerPub)
			const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
			return {
				groupId: dm.groupId,
				channelId: dm.defaultChannelId,
				/**
				 * @param {string} text 正文
				 * @returns {Promise<void>} 无
				 */
				post: async text => {
					await postChannelMessage(username, dm.groupId, dm.defaultChannelId, { text })
				},
			}
		}
		const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
		const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
		const groupId = await newGroup(username, { name: opts.label })
		const channelId = await getDefaultChannelId(username, groupId)
		return {
			groupId,
			channelId,
			/**
			 * @param {string} text 正文
			 * @returns {Promise<void>} 无
			 */
			post: async text => {
				await postChannelMessage(username, groupId, channelId, { text })
			},
		}
	}

	const { ensureBridgeGroup } = await import('../../src/chat/bridge/registry.mjs')
	const { postBridgeMessage } = await import('../../src/chat/bridge/ingress.mjs')
	const { groupId } = await ensureBridgeGroup(username, {
		platform: end,
		platformChatId: opts.platformChatId,
		chatKind: opts.chatKind,
		name: opts.label,
	})
	const channelId = await getDefaultChannelId(username, groupId)
	return {
		groupId,
		channelId,
		/**
		 * @param {string} text 正文
		 * @param {string | number} platformMessageId 平台消息 id
		 * @returns {Promise<void>} 无
		 */
		post: async (text, platformMessageId) => {
			await postBridgeMessage(username, {
				platform: end,
				platformChatId: opts.platformChatId,
				chatKind: opts.chatKind,
				platformMessageId,
				author: { platformUserId: `${end}-user`, displayName: `${end} User` },
				text,
				timestamp: Date.now(),
			})
		},
	}
}

const ENDS = /** @type {const} */ ['hub', 'telegram', 'discord', 'wechat']

Deno.test('four-end group: OnMessage willingness is consistent', async () => {
	const username = `parity-onmsg-${crypto.randomUUID().slice(0, 8)}`
	onMessageProbe.reset()
	onMessageProbe.returnValue = true
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_parity_onmsg_',
		minP2pNode: true,
		/** @param {string} user replica */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			await seedCharFixture(dataDir, user, CHAR_YES)
		},
	})
	await ensureServer()

	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	/** @type {Record<string, number>} */
	const triggeredByEnd = {}

	for (const [index, end] of ENDS.entries()) {
		onMessageProbe.reset()
		onMessageProbe.returnValue = true
		const before = onMessageProbe.events.length
		const session = await openEnd(end, username, {
			chatKind: 'group',
			label: `parity-onmsg-${end}`,
			platformChatId: 940000 + index,
		})
		await addchar(session.groupId, CHAR_YES, username)
		await session.post(`parity OnMessage ping ${end}`, 1000 + index)
		await waitUntil(async () => onMessageProbe.events.length > before, 15000)
		triggeredByEnd[end] = onMessageProbe.events.length - before
	}

	for (const end of ENDS)
		assert(triggeredByEnd[end] >= 1, `${end} should trigger OnMessage`)
})

Deno.test('four-end group: plain chars without OnMessage do not fallback-trigger', async () => {
	const username = `parity-plain-g-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_parity_plain_g_',
		minP2pNode: true,
		/** @param {string} user replica */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			await seedCharFixture(dataDir, user, [CHAR_PLAIN_A, CHAR_PLAIN_B])
		},
	})
	await ensureServer()

	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const replyMarkers = ['write_path_agent reply', 'plain_reply_b reply']

	for (const [index, end] of ENDS.entries()) {
		const session = await openEnd(end, username, {
			chatKind: 'group',
			label: `parity-plain-g-${end}`,
			platformChatId: 950000 + index,
		})
		await addchar(session.groupId, CHAR_PLAIN_A, username)
		await addchar(session.groupId, CHAR_PLAIN_B, username)
		await session.post(`group no-fallback ${end}`, 2000 + index)
		await new Promise(resolve => setTimeout(resolve, 500))
		const messages = await listMessages(username, session.groupId, session.channelId)
		assert(
			!messages.some(row => replyMarkers.some(marker => String(row.content?.content || '').includes(marker))),
			`${end} group must not fallback-trigger plain chars`,
		)
	}
})

Deno.test('four-end DM: plain chars fallback-trigger consistently (WX ingress-only)', async () => {
	const username = `parity-plain-dm-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer, dataDir } = createIntegrationBoot({
		username,
		tempDirPrefix: 'fount_bridge_parity_plain_dm_',
		minP2pNode: true,
		/** @param {string} user replica */
		afterInit: async user => {
			const { ensureOperatorPubKey } = await import('fount/public/parts/shells/chat/src/entity/identity.mjs')
			await ensureOperatorPubKey(user)
			await seedCharFixture(dataDir, user, [CHAR_PLAIN_A, CHAR_PLAIN_B])
		},
	})
	await ensureServer()

	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const replyMarkers = ['write_path_agent reply', 'plain_reply_b reply']
	/** @type {Record<string, boolean>} */
	const repliedByEnd = {}

	for (const [index, end] of ENDS.entries()) {
		const session = await openEnd(end, username, {
			chatKind: 'dm',
			label: `parity-plain-dm-${end}`,
			platformChatId: end === 'hub' ? `hub-dm-${index}` : `96000${index}`,
		})
		await addchar(session.groupId, CHAR_PLAIN_A, username)
		await addchar(session.groupId, CHAR_PLAIN_B, username)
		await session.post(`dm fallback ${end}`, 3000 + index)
		await waitUntil(async () => {
			const messages = await listMessages(username, session.groupId, session.channelId)
			return messages.some(row => replyMarkers.some(marker => String(row.content?.content || '').includes(marker)))
		}, 15000)
		repliedByEnd[end] = true
	}

	for (const end of ENDS)
		assertEquals(repliedByEnd[end], true, `${end} DM should fallback-trigger`)
})
