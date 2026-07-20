/**
 * Hub + mock TG/DC/WX 四端触发意愿一致性。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { onMessageProbe } from '../fixtures/probes/onMessageProbe.mjs'
import { createCharBoot, waitUntil } from '../harness.mjs'

const CHAR_YES = 'on_message_yes'
const CHAR_PLAIN_A = 'write_path_agent'
const CHAR_PLAIN_B = 'plain_reply_b'

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
 * @param {{ chatKind: 'group' | 'dm', label: string, platformChatId: string | number }} options 会话选项
 * @returns {Promise<{ groupId: string, channelId: string, post: (text: string, platformMessageId: string | number) => Promise<void> }>} 端会话句柄
 */
async function openEnd(end, username, options) {
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')

	if (end === 'hub') {
		if (options.chatKind === 'dm') {
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
		const groupId = await newGroup(username, { name: options.label })
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

	const { postBridgeMessage } = await import('../../src/chat/bridge/ingress.mjs')
	const { ensureBridgeGroup } = await import('../../src/chat/bridge/registry.mjs')
	const platform = end
	const { groupId } = await ensureBridgeGroup(username, {
		platform,
		platformChatId: options.platformChatId,
		chatKind: options.chatKind,
		name: options.label,
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
				platform,
				platformChatId: options.platformChatId,
				chatKind: options.chatKind,
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
	const { ensureServer } = createCharBoot({ username, chars: CHAR_YES })
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
	const { ensureServer } = createCharBoot({ username, chars: [CHAR_PLAIN_A, CHAR_PLAIN_B] })
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
	const { ensureServer } = createCharBoot({ username, chars: [CHAR_PLAIN_A, CHAR_PLAIN_B] })
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
