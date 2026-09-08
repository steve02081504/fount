/**
 * 重新生成（Hub 消息左下角 ↻）不丢历史：regenerate 只替换目标角色消息，
 * 之前的用户/角色消息必须保留在 DAG 上（刷新可恢复）。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { createCharBoot } from '../harness.mjs'

const CHAR = 'plain_reply_b'

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
 * 等待可见角色回复数达到期望并保持静默（生成 finalize 异步；auto-reply 链静默）。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @param {number} expected 期望可见角色回复数
 * @returns {Promise<object[]>} 静默后的消息行
 */
async function waitForVisibleCharReplies(username, groupId, channelId, expected) {
	const start = Date.now()
	let lastCount = -1
	let stableSince = Date.now()
	while (Date.now() - start < 20000) {
		const rows = await listMessages(username, groupId, channelId)
		const count = rows.filter(row => row.charId === CHAR).length
		if (count !== lastCount) {
			lastCount = count
			stableSince = Date.now()
		}
		if (count >= expected && Date.now() - stableSince > 800) return rows
		await new Promise(resolve => setTimeout(resolve, 50))
	}
	throw new Error(`visible char replies not reaching ${expected} (last ${lastCount})`)
}

/**
 * 复现 Hub「重新生成」完整序列（handleRegen 的三个 HTTP 调用）。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @param {string} eventId 被替换角色消息的 DAG eventId
 * @returns {Promise<void>}
 */
async function runRegenSequence(username, groupId, channelId, eventId) {
	const { modifyTimeLine } = await import('../../src/chat/session/timeLine.mjs')
	const { appendChannelMessageDelete } = await import('../../src/chat/channel/messageMutations.mjs')
	const { triggerCharReply } = await import('../../src/chat/session/triggerReply.mjs')
	await modifyTimeLine(groupId, channelId, Number.POSITIVE_INFINITY)
	await appendChannelMessageDelete(username, groupId, channelId, eventId)
	await triggerCharReply(groupId, channelId, CHAR)
}

Deno.test('regen replaces only the last char message and keeps prior history on DAG', async () => {
	const username = `regen-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createCharBoot({ username, chars: CHAR })
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')
	const { triggerCharReply } = await import('../../src/chat/session/triggerReply.mjs')

	const groupId = await newGroup(username, { name: 'regen-history' })
	const channelId = await getDefaultChannelId(username, groupId)
	await addchar(groupId, CHAR, username)

	const userTexts = [`regen-u1 ${username}`, `regen-u2 ${username}`]
	for (const text of userTexts) {
		await postChannelMessage(username, groupId, channelId, { text })
		await triggerCharReply(groupId, channelId, CHAR)
		await waitForVisibleCharReplies(username, groupId, channelId, userTexts.indexOf(text) + 1)
	}

	let rows = await waitForVisibleCharReplies(username, groupId, channelId, 2)
	assertEquals(countText(rows, userTexts[0]), 1, 'user1 on DAG before regen')
	assertEquals(countText(rows, userTexts[1]), 1, 'user2 on DAG before regen')
	assertEquals(rows.filter(row => row.charId === CHAR).length, 2, 'two char replies before regen')
	const lastChar = [...rows].reverse().find(row => row.charId === CHAR)
	assertEquals(!!lastChar, true, 'last char reply found')

	await runRegenSequence(username, groupId, channelId, lastChar.eventId)
	rows = await waitForVisibleCharReplies(username, groupId, channelId, 2)
	assertEquals(countText(rows, userTexts[0]), 1, 'user1 preserved after regen')
	assertEquals(countText(rows, userTexts[1]), 1, 'user2 preserved after regen')
	assertEquals(rows.filter(row => row.charId === CHAR).length, 2, 'old char1 + regenerated char reply both visible')
	assertEquals(rows.filter(row => row.charId === CHAR).some(row => row.eventId === lastChar.eventId), false, 'regenerated message is a new event (old one deleted)')
})
