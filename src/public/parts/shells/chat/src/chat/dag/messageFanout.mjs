import { buildMentionsStructure } from 'fount/public/parts/shells/chat/public/shared/mentions.mjs'
import { notifyUser } from 'fount/server/web_server/notify/notify.mjs'

import { hasPermission, PERMISSIONS } from '../../permissions/chat.mjs'
import { isCaredBy } from '../lib/care.mjs'
import {
	appendChatInbox,
	deriveChatInboxCareRow,
	deriveChatInboxMentionRow,
	deriveChatInboxMessageRow,
	listLocalRecipientsInGroup,
	mentionTextFromMessageLine,
	resolveAuthorFromMessageLine,
} from '../lib/inbox.mjs'
import { messageMentionsEntity } from '../lib/mentionFacts.mjs'
import {
	shouldAppendMessageInboxRow,
	shouldNotifyHumanForMessage,
} from '../lib/notifyPrefs.mjs'
import { resolveOperatorEntityHash } from '../lib/replica.mjs'
import { runTriggerPipeline } from '../session/triggerPipeline.mjs'

import { getState } from './materialize.mjs'

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} eventId 消息 eventId
 * @returns {string} Hub 深链
 */
function hubMessageUrl(groupId, channelId, eventId) {
	return `/parts/shells:chat/#group:${encodeURIComponent(groupId)}:${encodeURIComponent(channelId)};${encodeURIComponent(eventId)}`
}

/**
 * 从消息正文构建 mentions 结构（含 entity / role / everyone，受 sender 权限门控）。
 * @param {string} _username replica
 * @param {string} _groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} messageLine 频道消息行
 * @param {object} state 物化群状态
 * @param {{ ingress?: 'live' | 'backfill' }} [options] 入账语义
 * @returns {{ entityHashes: string[], roleIds: string[], everyone: boolean }}
 */
export function buildMentionsFromMessageLine(_username, _groupId, channelId, messageLine, state, options = {}) {
	const text = mentionTextFromMessageLine(messageLine)
	if (!text) return { entityHashes: [], roleIds: [], everyone: false }
	const senderKey = String(messageLine?.sender || '').trim().toLowerCase()
	const sender = state?.members?.[senderKey]
	const canMentionEveryone = sender?.status === 'active'
		&& hasPermission(sender, PERMISSIONS.MENTION_EVERYONE, state.roles, channelId, state.channelPermissions)
	return buildMentionsStructure(text, {
		canMentionEveryone,
		ingress: options.ingress === 'backfill' ? 'backfill' : 'live',
	})
}

/**
 * 消息落盘后的统一分发：per-recipient inbox + 人类触达 + 触发管线。
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

	const { state } = await getState(username, groupId)
	const mentions = buildMentionsFromMessageLine(username, groupId, channelId, messageLine, state, options)
	const recipients = await listLocalRecipientsInGroup(username, state)
	const operator = (await resolveOperatorEntityHash(username))?.toLowerCase() || null
	const senderKey = String(messageLine.sender || '').trim().toLowerCase()
	const { authorEntityHash, authorDisplayName } = resolveAuthorFromMessageLine(state, messageLine)
	const groupName = state.groupMeta?.name || groupId
	const channelName = state.channels?.[channelId]?.name || channelId

	const probeEvent = {
		mentions,
		group: { groupId },
		chatReplyRequest: { username },
		_username: username,
	}

	for (const recipientHash of recipients) {
		const mentioned = await messageMentionsEntity(probeEvent, recipientHash)
		if (mentioned) {
			const row = deriveChatInboxMentionRow(recipientHash, groupId, channelId, messageLine, state)
			if (row) await appendChatInbox(username, recipientHash, row)
		}

		if (recipientHash !== operator) continue

		const cared = authorEntityHash && await isCaredBy(username, recipientHash, authorEntityHash)
		if (cared) {
			const careRow = deriveChatInboxCareRow(recipientHash, groupId, channelId, messageLine, state)
			if (careRow) await appendChatInbox(username, recipientHash, careRow)
		}

		if (await shouldAppendMessageInboxRow(username, recipientHash, { groupId, channelId, state })) {
			const messageRow = deriveChatInboxMessageRow(recipientHash, groupId, channelId, messageLine, state)
			if (messageRow) await appendChatInbox(username, recipientHash, messageRow)
		}

		if (await shouldNotifyHumanForMessage(username, recipientHash, {
			authorEntityHash,
			groupId,
			channelId,
			state,
			probeEvent,
			ingress: options.ingress,
		})) {
			const eventId = messageLine.eventId || messageLine.content?.targetId
			const preview = mentionTextFromMessageLine(messageLine).slice(0, 120) || authorDisplayName
			void notifyUser(username, {
				title: `${groupName} · #${channelName}`,
				body: preview,
				url: hubMessageUrl(groupId, channelId, eventId),
				tag: eventId ? `chat:${eventId}` : undefined,
			})
		}
	}

	if (options.ingress !== 'backfill' && messageLine.type === 'message')
		await runTriggerPipeline(username, groupId, channelId, messageLine, { mentions }).catch(error => {
			console.error('runTriggerPipeline failed:', error)
		})

	return { mentions }
}
