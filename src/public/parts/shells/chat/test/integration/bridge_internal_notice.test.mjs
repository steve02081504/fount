/**
 * 桥接会话内部角色可见通知：非角色条目纯写入不出站、按需唤醒走生成、charVisibility 过滤。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { onMessageProbe } from '../fixtures/probes/onMessageProbe.mjs'
import { createCharBoot } from '../harness.mjs'

const CHAR = 'on_message_yes'
const REPLY_TEXT = 'on_message_yes reply'

/**
 * 建虚拟桥接会话、注册出站 handler 并构建一次请求。
 * @param {string} prefix 用户名前缀
 * @param {number} platformChatId 平台会话 id
 * @returns {Promise<{ username: string, session: object, outbound: object[], request: object, charAPI: object }>} 上下文
 */
async function setupBridge(prefix, platformChatId) {
	const username = `${prefix}-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createCharBoot({ username, chars: CHAR })
	await ensureServer()

	const { ensureVirtualBridgeSession } = await import('../../src/chat/bridge/session.mjs')
	const { registerBridgeOutbound } = await import('../../src/chat/bridge/outbound.mjs')
	const { buildVirtualBridgeChatRequest } = await import('../../src/chat/bridge/request.mjs')
	const { loadPart } = await import('fount/server/parts_loader.mjs')

	const session = ensureVirtualBridgeSession(username, {
		platform: 'telegram',
		platformChatId,
		chatKind: 'dm',
		name: 'notice-dm',
		botname: 'notice-bot',
		charname: CHAR,
	})
	const charAPI = await loadPart(username, `chars/${CHAR}`)
	/** @type {object[]} */
	const outbound = []
	registerBridgeOutbound(username, session.groupId, async ({ messageLine }) => {
		outbound.push(messageLine)
		return { platformMessageId: outbound.length }
	})
	const request = await buildVirtualBridgeChatRequest(username, session.groupId, 'default', CHAR, charAPI)
	return { username, session, outbound, request, charAPI }
}

Deno.test('non-char AppendChatLogEntry writes locally without outbound', async () => {
	const { session, outbound, request } = await setupBridge('bridge-notice-write', 973001)

	const written = await request.AppendChatLogEntry({
		role: 'system',
		content: '后台任务完成',
		charVisibility: [CHAR],
	})

	assertEquals(written.role, 'system')
	assertEquals(written.content, '后台任务完成')
	assert(session.channels.default.logs.includes(written))
	assertEquals(outbound.length, 0)
})

Deno.test('char AppendChatLogEntry still notifies outbound', async () => {
	const { outbound, request } = await setupBridge('bridge-notice-char', 973002)

	const written = await request.AppendChatLogEntry({ role: 'char', content: '主动说话' })

	assertEquals(written.role, 'char')
	assert(outbound.some(row => String(row.content).includes('主动说话')))
})

Deno.test('RequestCharReply runs GetReply and sends the reply outbound', async () => {
	onMessageProbe.reset()
	const { outbound, request } = await setupBridge('bridge-notice-wake', 973003)

	await request.RequestCharReply()

	assert(outbound.some(row => String(row.content).includes(REPLY_TEXT)))
	assertEquals(onMessageProbe.replies, 1)
})

Deno.test('chat_log excludes charVisibility entries not listing the char', async () => {
	const { username, session, request, charAPI } = await setupBridge('bridge-notice-vis', 973004)
	const { buildVirtualBridgeChatRequest } = await import('../../src/chat/bridge/request.mjs')

	await request.AppendChatLogEntry({ role: 'system', content: '只给别人的通知', charVisibility: ['other_char'] })
	await request.AppendChatLogEntry({ role: 'system', content: '给本角色的通知', charVisibility: [CHAR] })

	const rebuilt = await buildVirtualBridgeChatRequest(username, session.groupId, 'default', CHAR, charAPI)
	assert(!rebuilt.chat_log.some(entry => String(entry.content).includes('只给别人的通知')))
	assert(rebuilt.chat_log.some(entry => String(entry.content).includes('给本角色的通知')))
})
