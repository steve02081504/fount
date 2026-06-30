/**
 * 仅本机 chatLog 系统提示（不入 DAG、不联邦）。
 */
import { geti18nForUser } from '../../../../../../../scripts/i18n.mjs'

import { broadcastGroupEvent } from './broadcast.mjs'
import { getActiveGroupRuntime } from './persistence.mjs'
import { groupMetadatas } from './wsLifecycle.mjs'

/**
 * @param {string} groupId 群 ID
 * @param {string | null} channelId 频道 ID
 * @param {string} text 展示正文
 * @returns {Promise<void>}
 */
export async function appendLocalSystemChatLog(groupId, channelId, text) {
	const chatMetadata = await getActiveGroupRuntime(groupId)
	const owner = groupMetadatas.get(groupId)?.username || chatMetadata.username
	const entry = {
		role: 'system',
		name: await geti18nForUser(owner, 'chat.group.systemSenderName').catch(() => 'System'),
		content: text,
		content_for_show: text,
		timeSlice: chatMetadata.LastTimeSlice || { personas: {}, chars: {}, plugins: {} },
		extension: { groupChannelId: channelId || 'default', localOnly: true },
	}
	chatMetadata.chatLog.push(entry)
	chatMetadata.timeLines = [entry]
	chatMetadata.timeLineIndex = 0
	broadcastGroupEvent(groupId, {
		type: 'chat_log_entry',
		entry,
		channelId: channelId || 'default',
	})
}
