/**
 * 【文件】messages.mjs — 消息 CRUD（删改反馈）
 * 【职责】deleteMessage/setMessageFeedback 维护内存日志、广播 WS 事件、镜像 DAG 与 sidecar 一致性。
 * 【原理】deleteMessage 仅用于生成 abort 清理占位；human edit/delete 走频道 HTTP + channelUserHooks。反馈写入 entry.extension.feedback 并 mirrorFeedbackToDag。
 * 【数据结构】chatLog 索引、chatLogEntry_t、extension.feedback / groupChannelId。
 * 【关联】broadcast、generationFeedback、dag/chatLogMirror、generationAbort、channel/postMessage。
 */
/** @typedef {import('../../../../../../../decl/prompt_struct.ts').chatLogEntry_t} chatLogEntry_t */

import {
	mirrorDeleteToDag,
} from '../dag/chatLogMirror.mjs'
import { reconcileContextSidecarsWithChatLog } from '../dag/hydration.mjs'
import { resolveChannelId } from '../lib/channelId.mjs'
import { deleteLogContextSidecar } from '../lib/contextSidecar.mjs'

import { broadcastGroupEvent } from './broadcast.mjs'
import { BUILTIN_PERSONA, BUILTIN_WORLD } from './builtinParts.mjs'
import { abortGenerationByMessageId } from './generationAbort.mjs'
import { mirrorFeedbackToDag } from './generationFeedback.mjs'
import { timeSlice_t } from './models.mjs'
import { getActiveGroupRuntime } from './persistence.mjs'
import { groupMetadatas } from './wsLifecycle.mjs'

/**
 * 删除指定索引消息（仅生成 abort 路径）：splice chatLog 并 mirror DAG。
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

	chatMetadata.chatLog.splice(index, 1)

	const last = chatMetadata.chatLog[chatMetadata.chatLog.length - 1]

	if (index == chatMetadata.chatLog.length) {
		chatMetadata.timeLines = [last].filter(Boolean)
		chatMetadata.timeLineIndex = 0
	}

	if (chatMetadata.chatLog.length)
		chatMetadata.LastTimeSlice = last.extension.timeSlice
	else {
		chatMetadata.LastTimeSlice = new timeSlice_t()
		chatMetadata.LastTimeSlice.world = BUILTIN_WORLD
		chatMetadata.LastTimeSlice.player = BUILTIN_PERSONA
	}

	broadcastGroupEvent(groupId, { type: 'message_deleted', payload: { index } })

	const owner = groupMetadatas.get(groupId)?.username
	await mirrorDeleteToDag(groupId, entry, owner)
	await reconcileContextSidecarsWithChatLog(chatMetadata.username, groupId, chatMetadata.chatLog)
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
