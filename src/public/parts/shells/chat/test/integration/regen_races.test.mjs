/**
 * regen 竞态窗口不丢历史：regen 与在飞生成（auto-reply / regen 自身）并发时，
 * 用户历史必须保留在 DAG 上，刷新（runtime 重建）后仍可见。
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
 * 刷新模拟：失效 runtime 缓存后重新读取（DAG 全量重水合）。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @returns {Promise<object[]>} 重水合后的消息行
 */
async function rehydratedRows(username, groupId, channelId) {
	const { invalidateGroupRuntime } = await import('../../src/chat/session/runtime.mjs')
	invalidateGroupRuntime(groupId)
	return listMessages(username, groupId, channelId)
}

/**
 * 等待指定正文行数达到期望且在飞行列清空后保持静默。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @param {string} text 正文关键字
 * @param {number} expected 期望行数
 * @returns {Promise<object[]>} 静默后的消息行
 */
async function waitForTextAndQuiet(username, groupId, channelId, text, expected) {
	const { isCharReplyInFlight } = await import('../../src/chat/session/triggerReply.mjs')
	const start = Date.now()
	let lastCount = -1
	let stableSince = Date.now()
	while (Date.now() - start < 20000) {
		const rows = await listMessages(username, groupId, channelId)
		const count = countText(rows, text)
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

Deno.test('regen aborting an in-flight auto-reply keeps user history on DAG', async () => {
	const username = `regen-race1-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createCharBoot({ username, chars: CHAR })
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')

	const groupId = await newGroup(username, { name: 'regen-race1' })
	const channelId = await getDefaultChannelId(username, groupId)
	await addchar(groupId, CHAR, username)

	await postChannelMessage(username, groupId, channelId, { text: `race1-u1 ${username}` })
	let rows = await waitForTextAndQuiet(username, groupId, channelId, REPLY_TEXT, 1)
	const firstReply = [...rows].reverse().find(row => row.charId === CHAR && countText([row], REPLY_TEXT))
	assertEquals(!!firstReply, true, 'settled char reply found')

	// 用户消息 u2 落库 → pipeline 自动触发的生成在飞 → 立刻 regen c1（abort 竞态窗口）
	await postChannelMessage(username, groupId, channelId, { text: `race1-u2 ${username}` })
	await waitForCharReplyInFlight(groupId, channelId)
	await runRegenSequence(username, groupId, channelId, firstReply.eventId)
	await waitForTextAndQuiet(username, groupId, channelId, REPLY_TEXT, 0)
		.catch(() => { /* dedup 可能吞掉 regen 触发；断言只看历史 */ })

	rows = await rehydratedRows(username, groupId, channelId)
	assertEquals(countText(rows, `race1-u1 ${username}`), 1, 'user1 preserved after abort race')
	assertEquals(countText(rows, `race1-u2 ${username}`), 1, 'user2 preserved after abort race')
	assertEquals(rows.some(row => row.eventId === firstReply.eventId), false, 'regen target deleted')
})

Deno.test('user message landing during regen streaming keeps history on DAG', async () => {
	const username = `regen-race2-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createCharBoot({ username, chars: CHAR })
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')

	const groupId = await newGroup(username, { name: 'regen-race2' })
	const channelId = await getDefaultChannelId(username, groupId)
	await addchar(groupId, CHAR, username)

	await postChannelMessage(username, groupId, channelId, { text: `race2-u1 ${username}` })
	let rows = await waitForTextAndQuiet(username, groupId, channelId, REPLY_TEXT, 1)
	const firstReply = [...rows].reverse().find(row => row.charId === CHAR && countText([row], REPLY_TEXT))
	assertEquals(!!firstReply, true, 'settled char reply found')

	// regen 触发的生成在飞（~2s）→ 用户在此期间发送 u2（pipeline 触发被 flightKey 去重）
	await runRegenSequence(username, groupId, channelId, firstReply.eventId)
	await waitForCharReplyInFlight(groupId, channelId)
	await postChannelMessage(username, groupId, channelId, { text: `race2-u2 ${username}` })
	await waitForTextAndQuiet(username, groupId, channelId, REPLY_TEXT, 1)

	rows = await rehydratedRows(username, groupId, channelId)
	assertEquals(countText(rows, `race2-u1 ${username}`), 1, 'user1 preserved')
	assertEquals(countText(rows, `race2-u2 ${username}`), 1, 'user2 preserved')
	assertEquals(rows.some(row => row.eventId === firstReply.eventId), false, 'regen target deleted')
	assertEquals(countText(rows, REPLY_TEXT) >= 1, true, 'regenerated reply present')
})

Deno.test('regen-send-regen loop keeps full history on DAG', async () => {
	const username = `regen-race3-${crypto.randomUUID().slice(0, 8)}`
	const { ensureServer } = createCharBoot({ username, chars: CHAR })
	await ensureServer()

	const { newGroup } = await import('../../src/chat/session/groupLifecycle.mjs')
	const { addchar } = await import('../../src/chat/session/partConfig.mjs')
	const { getDefaultChannelId } = await import('../../src/chat/dag/queries.mjs')
	const { postChannelMessage } = await import('../../src/chat/channel/postMessage.mjs')

	const groupId = await newGroup(username, { name: 'regen-race3' })
	const channelId = await getDefaultChannelId(username, groupId)
	await addchar(groupId, CHAR, username)

	await postChannelMessage(username, groupId, channelId, { text: `race3-u1 ${username}` })
	let rows = await waitForTextAndQuiet(username, groupId, channelId, REPLY_TEXT, 1)
	const firstReply = [...rows].reverse().find(row => row.charId === CHAR && countText([row], REPLY_TEXT))

	// regen → 静默 → 发消息 → 静默 → 再 regen（真实用户循环）
	await runRegenSequence(username, groupId, channelId, firstReply.eventId)
	rows = await waitForTextAndQuiet(username, groupId, channelId, REPLY_TEXT, 1)
	const regeneratedFirstReply = [...rows].reverse().find(row => row.charId === CHAR && countText([row], REPLY_TEXT))
	assertEquals(!!regeneratedFirstReply && regeneratedFirstReply.eventId !== firstReply.eventId, true, 'regenerated c1 present')

	await postChannelMessage(username, groupId, channelId, { text: `race3-u2 ${username}` })
	rows = await waitForTextAndQuiet(username, groupId, channelId, REPLY_TEXT, 2)
	const secondReply = [...rows].reverse().find(row => row.charId === CHAR && countText([row], REPLY_TEXT))

	await runRegenSequence(username, groupId, channelId, secondReply.eventId)
	await waitForTextAndQuiet(username, groupId, channelId, REPLY_TEXT, 2)

	rows = await rehydratedRows(username, groupId, channelId)
	assertEquals(countText(rows, `race3-u1 ${username}`), 1, 'user1 preserved after loop')
	assertEquals(countText(rows, `race3-u2 ${username}`), 1, 'user2 preserved after loop')
	assertEquals(countText(rows, REPLY_TEXT), 2, 'two regenerated char replies visible')
	assertEquals(rows.some(row => row.eventId === firstReply.eventId), false, 'first target deleted')
	assertEquals(rows.some(row => row.eventId === secondReply.eventId), false, 'second target deleted')
})
