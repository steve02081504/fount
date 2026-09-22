/**
 * 异步通知触发的 shell 侧待触发队列：生成中追加的系统条目未消费则结束后补一次生成，已消费则不重复。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { createCharBoot } from '../harness.mjs'

const CHAR = 'slow_reply'
const REPLY_TEXT = 'slow_reply done'

/**
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @returns {Promise<object[]>} 消息行
 */
async function listMessages(username, groupId, channelId) {
	const { readChannelMessagesForUser } = await import('../../src/group/queries.mjs')
	return readChannelMessagesForUser(username, groupId, channelId, { limit: 200 })
}

/**
 * @param {object[]} rows 消息行
 * @param {string} text 正文关键字
 * @returns {number} 匹配行数
 */
function countText(rows, text) {
	return rows.filter(row => String(row.content?.content || '').includes(text)).length
}

/**
 * 轮询等待角色回复进入在飞状态（触发已发出、生成尚未完成）。
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @returns {Promise<void>}
 */
async function waitForCharReplyInFlight(groupId, channelId) {
	const { isCharReplyInFlight } = await import('../../src/chat/session/triggerReply.mjs')
	const start = Date.now()
	while (Date.now() - start < 20000) {
		if (isCharReplyInFlight(groupId, channelId, CHAR)) return
		await new Promise(resolve => setTimeout(resolve, 60))
	}
	throw new Error('char reply never became in-flight')
}

/**
 * 等待指定正文行数达到期望且在飞行列清空后保持静默。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @param {number} expected 期望行数
 * @returns {Promise<object[]>} 静默后的消息行
 */
async function waitForTextAndQuiet(username, groupId, channelId, expected) {
	const { isCharReplyInFlight } = await import('../../src/chat/session/triggerReply.mjs')
	const start = Date.now()
	let lastCount = -1
	let stableSince = Date.now()
	while (Date.now() - start < 25000) {
		const rows = await listMessages(username, groupId, channelId)
		const count = countText(rows, REPLY_TEXT)
		const quiet = !isCharReplyInFlight(groupId, channelId, CHAR)
		if (count !== lastCount) {
			lastCount = count
			stableSince = Date.now()
		}
		if (count >= expected && quiet && Date.now() - stableSince > 1200) return rows
		await new Promise(resolve => setTimeout(resolve, 60))
	}
	throw new Error(`text rows not reaching ${expected} (last ${lastCount})`)
}

/**
 * 建群、加慢速角色并启动一次生成。
 * @param {string} name 群名
 * @returns {Promise<{ username: string, groupId: string, channelId: string }>} 会话上下文
 */
async function setupGeneratingSession(name) {
	const username = `${name}-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createCharBoot({ username, chars: CHAR })
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { triggerCharReply } = await import('../../src/chat/session/triggerReply.mjs')

	const groupId = await newGroup(username, { name })
	const channelId = await getDefaultChannelId(username, groupId)
	await addchar(groupId, CHAR, username)

	await triggerCharReply(groupId, channelId, CHAR)
	await waitForCharReplyInFlight(groupId, channelId)
	return { username, groupId, channelId }
}

Deno.test('a notification appended mid-generation drains into a follow-up generation', async () => {
	const { username, groupId, channelId } = await setupGeneratingSession('async-drain')

	const { getChatRequest } = await import('../../src/chat/session/chatRequest.mjs')
	const request = await getChatRequest(groupId, CHAR, channelId)
	await request.AddChatLogEntry({ role: 'system', content: '后台任务完成', charVisibility: [CHAR] })

	const rows = await waitForTextAndQuiet(username, groupId, channelId, 2)
	assertEquals(countText(rows, REPLY_TEXT), 2, '未消费的待触发应在生成结束后补一次')

	const rebuilt = await getChatRequest(groupId, CHAR, channelId)
	assertEquals(rebuilt.chat_log.some(entry => String(entry.content).includes('后台任务完成')), true,
		'本地角色可见条目应补入后续请求（不入 DAG）')
})

Deno.test('a notification cleared mid-generation does not produce a follow-up', async () => {
	const { username, groupId, channelId } = await setupGeneratingSession('async-consumed')

	const { getChatRequest } = await import('../../src/chat/session/chatRequest.mjs')
	const request = await getChatRequest(groupId, CHAR, channelId)
	await request.AddChatLogEntry({ role: 'system', content: '后台任务完成', charVisibility: [CHAR] })
	request.ClearPendingMessages()

	const rows = await waitForTextAndQuiet(username, groupId, channelId, 1)
	assertEquals(countText(rows, REPLY_TEXT), 1, '已消费则不补触发')
})
