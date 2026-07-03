/**
 * 【文件】autoReply.mjs — 频道消息入库后的角色自动回复调度
 * 【职责】在 DAG message 落盘后判断是否应本机触发角色生成：@mention、单角色私聊、或按群设置 autoReplyFrequency 定频轮询。
 * 【原理】maybeAutoTriggerCharReply 跳过 isAutoTrigger/角色消息/无角色群；mention 命中则 dispatchLocalCharReply；单角色直接回复；多角色按计数器每 N 条触发一次（mentionTarget 为空时由 triggerReply 随机选角）；同槽位生成中则跳过。
 * 【数据结构】autoReplyFrequencyByChannel（Map<groupId\\0channelId, { messageCount }>）、state.groupSettings.autoReplyFrequency。
 * 【关联】triggerReply、partConfig.getCharListOfGroup、groupWsHub、DAG materialize。
 */
import { channelMessageAgentText } from '../../../public/src/lib/channelContent.mjs'
import { getState } from '../dag/materialize.mjs'

import { getCharListOfGroup } from './partConfig.mjs'
import { isCharReplyInFlight, triggerCharReply } from './triggerReply.mjs'

/** groupId+channelId → 定频触发计数 */
const autoReplyFrequencyByChannel = new Map()

/**
 * @param {unknown} content DAG message content
 * @returns {string | null} 提取到的角色名；无则为 null
 */
function extractMentionTarget(content) {
	const match = channelMessageAgentText(content)?.match(/^@([\w.-]+)(?:\s|$)/u)
	return match?.[1] ?? null
}

/**
 * 本机触发角色回复；同槽位已在生成则跳过。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {string | null} charname 角色名；null 时由 triggerReply 选角
 * @returns {Promise<void>}
 */
async function dispatchLocalCharReply(groupId, channelId, charname) {
	if (charname && isCharReplyInFlight(groupId, channelId, charname)) return
	try {
		await triggerCharReply(groupId, channelId, charname)
	}
	catch (error) {
		console.error('maybeAutoTriggerCharReply triggerCharReply failed:', error)
	}
}

/**
 * 每条频道 `message` 入库后：群内有角色则按 @mention / 单角色私聊 / 定频设置触发回复。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {unknown} [messageContent] 消息内容
 * @param {{ charId?: string } | null} [signPayload] 已落盘事件（用于跳过角色消息）
 * @returns {Promise<void>}
 */
export async function maybeAutoTriggerCharReply(username, groupId, channelId, messageContent, signPayload = null) {
	if (messageContent?.isAutoTrigger || signPayload?.charId || messageContent?.role === 'char') return

	const chars = await getCharListOfGroup(groupId, username)
	if (!chars.length) return

	const mentionTarget = extractMentionTarget(messageContent)
	if (mentionTarget && chars.includes(mentionTarget))
		return dispatchLocalCharReply(groupId, channelId, mentionTarget)

	if (chars.length === 1)
		return dispatchLocalCharReply(groupId, channelId, chars[0])

	const { state } = await getState(username, groupId)
	const frequency = Number(state.groupSettings?.autoReplyFrequency) || 0
	if (frequency <= 0) return

	const trackerKey = `${groupId}\0${channelId}`
	let tracker = autoReplyFrequencyByChannel.get(trackerKey)
	if (!tracker) {
		tracker = { messageCount: 0 }
		autoReplyFrequencyByChannel.set(trackerKey, tracker)
	}
	if (++tracker.messageCount < frequency) return
	tracker.messageCount = 0
	await dispatchLocalCharReply(groupId, channelId, null)
}
