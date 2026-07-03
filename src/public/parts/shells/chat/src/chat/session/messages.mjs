/**
 * 【文件】messages.mjs — 用户消息与消息 CRUD（增删改反馈）
 * 【职责】addUserReply 装配用户条目并走 addChatLogEntry；deleteMessage/editMessage/setMessageFeedback 维护内存日志、广播 WS 事件、镜像 DAG 与 sidecar 一致性。
 * 【原理】删除/编辑优先委托世界或角色/人格的 chat 接口钩子，无钩子则默认 splice 或重建条目；编辑后按 char/user 分支 buildChatLogEntryFrom*；反馈写入 entry.extension.feedback 并 mirrorFeedbackToDag。
 * 【数据结构】chatLog 索引、chatLogEntry_t、extension.feedback / groupChannelId。
 * 【关联】generation（addChatLogEntry）、broadcast、logEntries、generationFeedback、dag/chatLogMirror、generationAbort。
 */
/** @typedef {import('../../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../../../decl/userAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../../../decl/pluginAPI.ts').PluginAPI_t} PluginAPI_t */
/** @typedef {import('../../../../../../../decl/basedefs.ts').locale_t} locale_t */

import { unlockAchievement } from '../../../../achievements/src/api.mjs'
import {
	mirrorDeleteToDag,
	mirrorEditToDag,
} from '../dag/chatLogMirror.mjs'
import { reconcileContextSidecarsWithChatLog } from '../dag/hydration.mjs'
import { resolveChannelId } from '../lib/channelId.mjs'
import { deleteLogContextSidecar } from '../lib/contextSidecar.mjs'

import { broadcastGroupEvent } from './broadcast.mjs'
import { addChatLogEntry } from './chatLogAppend.mjs'
import { abortGenerationByMessageId } from './generationAbort.mjs'
import { mirrorFeedbackToDag } from './generationFeedback.mjs'
import {
	buildChatLogEntryFromCharReply,
	buildChatLogEntryFromUserMessage,
} from './logEntries.mjs'
import { timeSlice_t } from './models.mjs'
import { getActiveGroupRuntime } from './persistence.mjs'
import { groupMetadatas } from './wsLifecycle.mjs'

/**
 * 添加用户消息到聊天日志（含群频道扩展）。
 * @param {string} groupId 聊天 ID
 * @param {string} channelId 群频道 ID
 * @param {object} object 用户回复载荷（content、files 等）
 * @returns {Promise<chatLogEntry_t>} 新条目
 */
export async function addUserReply(groupId, channelId, object) {
	const chatMetadata = await getActiveGroupRuntime(groupId)
	if (!chatMetadata) throw new Error('Group not found')

	const timeSlice = chatMetadata.LastTimeSlice.copy()
	const user = chatMetadata.LastTimeSlice.player

	void unlockAchievement(chatMetadata.username, 'shells/chat', 'first_chat')
	if (object.files?.some?.(file => file.mime_type?.startsWith('image/')))
		void unlockAchievement(chatMetadata.username, 'shells/chat', 'photo_chat')

	return addChatLogEntry(groupId, await buildChatLogEntryFromUserMessage({
		...object,
		groupChannelId: object.groupChannelId || channelId,
	}, timeSlice, user, timeSlice.player_id, chatMetadata.username))
}

/**
 * 删除指定索引消息：调用世界/角色/用户 MessageDelete 钩子或默认 splice。
 * @param {string} groupId 聊天 ID
 * @param {number} index chatLog 索引
 * @returns {Promise<void>}
 */
export async function deleteMessage(groupId, index) {
	const chatMetadata = await getActiveGroupRuntime(groupId)
	if (!chatMetadata) throw new Error('Group not found')
	if (!chatMetadata.chatLog[index]) throw new Error('Invalid index')

	const entry = chatMetadata.chatLog[index]
	if (entry) {
		abortGenerationByMessageId(entry.id)
		const sidecarChannelId = resolveChannelId(entry.extension?.groupChannelId)
		deleteLogContextSidecar(chatMetadata.username, groupId, sidecarChannelId, entry.id)
	}

	if (chatMetadata.LastTimeSlice.world?.interfaces?.chat?.MessageDelete)
		await chatMetadata.LastTimeSlice.world.interfaces.chat.MessageDelete({
			index,
			chat_log: chatMetadata.chatLog,
			chat_entry: chatMetadata.chatLog[index],
		})
	else {
		const deleteRequest = {
			index,
			chat_log: chatMetadata.chatLog,
			chat_entry: chatMetadata.chatLog[index],
		}
		for (const char of Object.values(chatMetadata.LastTimeSlice.chars))
			await char.interfaces.chat?.MessageDelete?.(deleteRequest)
		await chatMetadata.LastTimeSlice.player?.interfaces?.chat?.MessageDelete?.(deleteRequest)
		chatMetadata.chatLog.splice(index, 1)
	}

	const last = chatMetadata.chatLog[chatMetadata.chatLog.length - 1]

	if (index == chatMetadata.chatLog.length) {
		chatMetadata.timeLines = [last].filter(Boolean)
		chatMetadata.timeLineIndex = 0
	}

	if (chatMetadata.chatLog.length)
		chatMetadata.LastTimeSlice = last.extension.timeSlice
	else
		chatMetadata.LastTimeSlice = new timeSlice_t()

	broadcastGroupEvent(groupId, { type: 'message_deleted', payload: { index } })

	const owner = groupMetadatas.get(groupId)?.username
	await mirrorDeleteToDag(groupId, entry, owner)
	await reconcileContextSidecarsWithChatLog(chatMetadata.username, groupId, chatMetadata.chatLog)
}

/**
 * 编辑指定索引消息：经世界/角色 MessageEdit 后写回并镜像 DAG。
 * @param {string} groupId 聊天 ID
 * @param {number} index chatLog 索引
 * @param {object} newContent 编辑载荷
 * @returns {Promise<chatLogEntry_t>} 更新后的条目
 */
export async function editMessage(groupId, index, newContent) {
	const chatMetadata = await getActiveGroupRuntime(groupId)
	if (!chatMetadata) throw new Error('Group not found')
	if (!chatMetadata.chatLog[index]) throw new Error('Invalid index')

	const originalEntryId = chatMetadata.chatLog[index].id

	const editRequest = {
		index,
		original: chatMetadata.chatLog[index],
		edited: newContent,
		chat_log: chatMetadata.chatLog,
	}
	let editedContent
	if (chatMetadata.LastTimeSlice.world?.interfaces?.chat?.MessageEdit)
		editedContent = await chatMetadata.LastTimeSlice.world.interfaces.chat.MessageEdit(editRequest)
	else {
		const entry = chatMetadata.chatLog[index]
		if (entry.extension.timeSlice.charname) {
			const char = entry.extension.timeSlice.chars[entry.extension.timeSlice.charname]
			editedContent = await char.interfaces.chat?.MessageEdit?.(editRequest)
		}
		else if (entry.extension.timeSlice.playername)
			editedContent = await entry.extension.timeSlice?.player?.interfaces?.chat?.MessageEdit?.(editRequest)
		editedContent ??= newContent

		if (chatMetadata.LastTimeSlice.world?.interfaces?.chat?.MessageEditing)
			await chatMetadata.LastTimeSlice.world.interfaces.chat.MessageEditing(editRequest)
		else {
			for (const char of Object.values(chatMetadata.LastTimeSlice.chars))
				await char.interfaces?.chat?.MessageEditing?.(editRequest)

			await chatMetadata.LastTimeSlice.player?.interfaces?.chat?.MessageEditing?.(editRequest)
		}
	}

	const timeSlice = chatMetadata.chatLog[index].extension.timeSlice
	const entry = timeSlice.charname
		? await buildChatLogEntryFromCharReply(
			editedContent,
			timeSlice,
			timeSlice.chars[timeSlice.charname],
			timeSlice.charname,
			chatMetadata.username,
		)
		: await buildChatLogEntryFromUserMessage(editedContent, timeSlice, timeSlice.player, timeSlice.player_id, chatMetadata.username)

	chatMetadata.chatLog[index] = entry
	if (index == chatMetadata.chatLog.length - 1)
		chatMetadata.timeLines[chatMetadata.timeLineIndex] = entry

	broadcastGroupEvent(groupId, { type: 'message_edited', payload: { index, entry: await entry.toData(chatMetadata.username) } })

	const owner = groupMetadatas.get(groupId)?.username
	await mirrorEditToDag(groupId, originalEntryId, entry, owner)

	return entry
}

/**
 * 设置消息反馈扩展字段并广播替换事件、镜像 DAG。
 * @param {string} groupId 聊天 ID
 * @param {number} index chatLog 索引
 * @param {object} feedback 反馈对象
 * @returns {Promise<chatLogEntry_t>} 更新后的条目
 */
export async function setMessageFeedback(groupId, index, feedback) {
	const chatMetadata = await getActiveGroupRuntime(groupId)
	if (!chatMetadata) throw new Error('Group not found')
	if (!chatMetadata.chatLog[index]) throw new Error('Invalid index')
	const entry = chatMetadata.chatLog[index]
	entry.extension ??= {}
	entry.extension.feedback = feedback
	if (index === chatMetadata.chatLog.length - 1 && chatMetadata.timeLines[chatMetadata.timeLineIndex]?.id === entry.id)
		chatMetadata.timeLines[chatMetadata.timeLineIndex] = entry
	broadcastGroupEvent(groupId, { type: 'message_replaced', payload: { index, entry: await entry.toData(chatMetadata.username) } })

	const owner = groupMetadatas.get(groupId)?.username
	await mirrorFeedbackToDag(groupId, entry, feedback, owner)

	return entry
}
