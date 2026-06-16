/**
 * 【文件】chatLogAppend.mjs — 聊天日志追加与 DAG 同步入口
 * 【职责】将 chatLogEntry 写入内存元数据、持久化 context sidecar；同步到 DAG；角色消息发系统通知；触发世界 AfterAddChatLogEntry 或自动回复频率链。
 * 【原理】appendLogCore 优先走 world.interfaces.chat.AddChatLogEntry，否则 push 到 chatLog 并更新 timeLines/LastTimeSlice；addChatLogEntry 完整路径含成就、通知与后续钩子；addChatLogEntryImport 跳过广播与自动回复，供批量导入。
 * 【数据结构】chatMetadata.chatLog、entry.extension.groupChannelId、侧车 channelId。
 * 【关联】persistence、chatRequest、triggerReply、dag/chatLogMirror、broadcast（间接）、generation 再导出。
 */
/** @typedef {import('../../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../../../decl/userAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../../../decl/pluginAPI.ts').PluginAPI_t} PluginAPI_t */
/** @typedef {import('../../../../../../../decl/basedefs.ts').locale_t} locale_t */


import { sendNotification } from '../../../../../../../server/web_server/event_dispatcher.mjs'
import { unlockAchievement } from '../../../../achievements/src/api.mjs'
import {
	syncChatLogEntryToDag,
} from '../dag/chatLogMirror.mjs'
import { resolveGroupChannelId } from '../lib/channelId.mjs'
import { persistLogContextSidecar } from '../lib/contextSidecar.mjs'

import { getChatRequest } from './chatRequest.mjs'
import { getActiveGroupRuntime } from './persistence.mjs'
import { getCharReplyFrequency } from './triggerReply.mjs'
import { groupMetadatas } from './wsLifecycle.mjs'

/**
 * 追加一条日志到元数据并持久化侧车。
 * @param {string} groupId 群 ID
 * @param {object} chatMetadata 会话元数据
 * @param {object} entry 日志条目
 * @returns {Promise<void>}
 */
async function appendLogCore(groupId, chatMetadata, entry) {
	if (entry.timeSlice.world?.interfaces?.chat?.AddChatLogEntry)
		await entry.timeSlice.world.interfaces.chat.AddChatLogEntry(await getChatRequest(groupId, undefined, entry.extension?.groupChannelId || null), entry)
	else
		chatMetadata.chatLog.push(entry)

	const sidecarChannel = await resolveGroupChannelId(chatMetadata.username, groupId, entry.extension?.groupChannelId)
	await persistLogContextSidecar(chatMetadata.username, groupId, sidecarChannel, entry)

	chatMetadata.timeLines = [entry]
	chatMetadata.timeLineIndex = 0
	chatMetadata.LastTimeSlice = entry.timeSlice
}

/**
 * 追加聊天日志并触发 DAG 同步、通知与自动回复。
 * @param {string} groupId 群 ID
 * @param {object} entry 日志条目
 * @returns {Promise<object>} 写入后的条目
 */
export async function addChatLogEntry(groupId, entry) {
	const chatMetadata = await getActiveGroupRuntime(groupId)
	await appendLogCore(groupId, chatMetadata, entry)

	if (entry.role === 'char' && entry.timeSlice.charname) {
		const spokenChars = new Set(chatMetadata.chatLog.filter(e => e.role === 'char' && e.timeSlice.charname).map(e => e.timeSlice.charname))
		if (spokenChars.size >= 2)
			void unlockAchievement(chatMetadata.username, 'shells/chat', 'multiplayer_chat')
	}

	const owner = groupMetadatas.get(groupId)?.username
	await syncChatLogEntryToDag(groupId, entry, owner)

	if (entry.role === 'char')
		sendNotification(chatMetadata.username, entry.name ?? 'Character', {
			body: entry.content,
			icon: entry.avatar || '/favicon.svg',
			data: {
				url: `/parts/shells:chat/hub/#group:${groupId}:default`,
			},
		}, `/parts/shells:chat/hub/#group:${groupId}:default`)

	const replyFrequency = await getCharReplyFrequency(groupId)
	if (entry.timeSlice.world?.interfaces?.chat?.AfterAddChatLogEntry)
		await entry.timeSlice.world.interfaces.chat.AfterAddChatLogEntry(await getChatRequest(groupId, undefined, entry.extension?.groupChannelId || null), replyFrequency)

	return entry
}

/**
 * 导入路径追加日志（不广播、不自动回复）。
 * @param {string} groupId 群 ID
 * @param {object} entry 日志条目
 * @returns {Promise<object>} 写入后的条目
 */
export async function addChatLogEntryImport(groupId, entry) {
	const chatMetadata = await getActiveGroupRuntime(groupId)
	await appendLogCore(groupId, chatMetadata, entry)

	const owner = groupMetadatas.get(groupId)?.username
	await syncChatLogEntryToDag(groupId, entry, owner)

	return entry
}
