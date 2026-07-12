import { extractMentionEntityHashes } from 'fount/public/pages/scripts/lib/mentions.mjs'

import {
	appendChatInbox,
	deriveChatInboxMentionRow,
	listLocalRecipientsInGroup,
	mentionTextFromMessageLine,
} from '../lib/inbox.mjs'
import { messageMentionsEntity } from '../lib/mentionFacts.mjs'
import { runTriggerPipeline } from '../session/triggerPipeline.mjs'

import { getState } from './materialize.mjs'

/**
 * 从消息正文构建 mentions 结构（M1：仅 entityHashes）。
 * @param {object} messageLine 频道消息行
 * @returns {{ entityHashes: string[], roleIds: string[], everyone: boolean }} 解析后的 mentions 结构
 */
export function buildMentionsFromMessageLine(messageLine) {
	const text = mentionTextFromMessageLine(messageLine)
	const entityHashes = text ? extractMentionEntityHashes(text) : []
	return { entityHashes, roleIds: [], everyone: false }
}

/**
 * 消息落盘后的统一分发：per-recipient inbox + 触发管线。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} messageLine 频道消息行
 * @param {{ ingress?: 'live' | 'backfill' }} [options] 入账语义
 * @returns {Promise<{ mentions: object }>} 解析后的 mentions 结构（供 WS 广播）
 */
export async function dispatchMessageFanout(username, groupId, channelId, messageLine, options = {}) {
	if (!['message', 'message_edit'].includes(messageLine?.type)) return { mentions: { entityHashes: [], roleIds: [], everyone: false } }
	if (messageLine.type === 'message_edit') {
		const newContent = messageLine.content?.newContent ?? messageLine.content
		if (newContent?.is_generating) return { mentions: { entityHashes: [], roleIds: [], everyone: false } }
	}

	const mentions = buildMentionsFromMessageLine(messageLine)
	const { state } = await getState(username, groupId)
	const recipients = await listLocalRecipientsInGroup(username, state)

	const probeEvent = {
		mentions,
		group: { groupId },
		chatReplyRequest: { username },
		_username: username,
	}

	for (const recipientHash of recipients) {
		if (!await messageMentionsEntity(probeEvent, recipientHash)) continue
		const row = deriveChatInboxMentionRow(recipientHash, groupId, channelId, messageLine, state)
		if (!row) continue
		await appendChatInbox(username, recipientHash, row)
	}

	if (options.ingress !== 'backfill' && messageLine.type === 'message')
		await runTriggerPipeline(username, groupId, channelId, messageLine, { mentions }).catch(error => {
			console.error('runTriggerPipeline failed:', error)
		})

	return { mentions }
}
