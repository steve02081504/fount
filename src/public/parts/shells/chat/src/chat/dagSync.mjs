import { appendEvent, ensureChat, getDefaultChannelId, getState, isValidChannelId, listChannelMessages } from './dag.mjs'
import { applyMailboxE2EToDagContent } from './e2e_mailbox.mjs'

/**
 * 将日志条目的 content 字段规范为可写入 DAG 的纯文本。
 * @param {object} entry 聊天条目
 * @returns {string} 扁平文本
 */
function entryContentToMirrorText(entry) {
	const c = entry.content
	if (typeof c === 'string') return c
	if (c && typeof c === 'object') return JSON.stringify(c)
	return ''
}

/**
 * 将非问候类聊天条目镜像为 DAG message 事件。
 * @param {string} groupId 聊天 ID
 * @param {object} entry 条目
 * @param {string} username 所有者
 * @returns {Promise<void>}
 */
export async function syncChatLogEntryToDag(groupId, entry, username) {
	try {
		if (entry.is_generating) return
		if (entry.timeSlice?.greeting_type) return
		if (!username) return
		const text = entryContentToMirrorText(entry)
		const hasFiles = Array.isArray(entry.files) && entry.files.length > 0
		if (!text.trim() && !hasFiles) return
		await ensureChat(username, groupId)
		let ts = entry.time_stamp ? +new Date(entry.time_stamp) : Date.now()
		if (!Number.isFinite(ts)) ts = Date.now()
		let sender = 'user'
		if (entry.role === 'char')
			sender = entry.name || entry.timeSlice?.charname || 'char'
		else if (entry.role === 'user')
			sender = 'user'
		else
			sender = entry.name || entry.role || 'system'
		const content = {
			text: text.slice(0, 200_000),
			chatLogEntryId: entry.id,
			role: entry.role,
		}
		if (hasFiles) content.fileCount = entry.files.length
		if (entry.visibility) content.visibility = entry.visibility
		if (entry.charVisibility?.length) content.charVisibility = entry.charVisibility
		const groupCh = entry.extension?.groupChannelId
		const channelIdForDag = isValidChannelId(groupCh)
			? groupCh
			: await getDefaultChannelId(username, groupId)
		const recentMessages = await listChannelMessages(username, groupId, channelIdForDag, { limit: 1 })
		const prevMessageEventId = recentMessages[recentMessages.length - 1]?.eventId
		if (prevMessageEventId) content.prevMessageEventId = prevMessageEventId
		const { state } = await getState(username, groupId)
		const contentForDag = applyMailboxE2EToDagContent(content, text.slice(0, 200_000), state, channelIdForDag)
		await appendEvent(username, groupId, {
			type: 'message',
			channelId: channelIdForDag,
			sender,
			timestamp: ts,
			charId: entry.timeSlice?.charname,
			content: contentForDag,
		})
	}
	catch (e) {
		console.error(e)
	}
}

/**
 * 将删除操作镜像为 DAG message_delete 事件。
 * @param {string} groupId 聊天 ID
 * @param {object} deletedEntry 被删条目
 * @param {string} username 所有者
 * @returns {Promise<void>}
 */
export async function mirrorDeleteToDag(groupId, deletedEntry, username) {
	try {
		if (!deletedEntry?.id || !username) return
		if (deletedEntry.timeSlice?.greeting_type) return
		await ensureChat(username, groupId)
		await appendEvent(username, groupId, {
			type: 'message_delete',
			channelId: await getDefaultChannelId(username, groupId),
			sender: 'local',
			timestamp: Date.now(),
			content: { chatLogEntryId: deletedEntry.id },
		})
	}
	catch (e) {
		console.error(e)
	}
}

/**
 * 将编辑结果镜像为 DAG message_edit 事件。
 * @param {string} groupId 聊天 ID
 * @param {string} originalEntryId 原条目 UUID
 * @param {object} entry 编辑后的条目
 * @param {string} username 所有者
 * @returns {Promise<void>}
 */
export async function mirrorEditToDag(groupId, originalEntryId, entry, username) {
	try {
		if (!originalEntryId || !username) return
		if (entry.timeSlice?.greeting_type) return
		const text = entryContentToMirrorText(entry)
		const hasFiles = Array.isArray(entry.files) && entry.files.length > 0
		await ensureChat(username, groupId)
		const groupCh = entry.extension?.groupChannelId
		const channelIdForDag = isValidChannelId(groupCh)
			? groupCh
			: await getDefaultChannelId(username, groupId)
		const content = {
			chatLogEntryId: originalEntryId,
			text: text.slice(0, 200_000),
		}
		if (hasFiles) content.fileCount = entry.files.length
		const { state } = await getState(username, groupId)
		const contentForDag = applyMailboxE2EToDagContent(content, text.slice(0, 200_000), state, channelIdForDag)
		await appendEvent(username, groupId, {
			type: 'message_edit',
			channelId: channelIdForDag,
			sender: 'local',
			timestamp: Date.now(),
			content: contentForDag,
		})
	}
	catch (e) {
		console.error(e)
	}
}
