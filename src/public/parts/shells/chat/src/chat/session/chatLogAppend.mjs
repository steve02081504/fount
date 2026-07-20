/**
 * 【文件】chatLogAppend.mjs — 聊天日志追加与 DAG 同步入口
 * 【职责】将 chatLogEntry 写入内存元数据、持久化 context sidecar；同步到 DAG；角色消息发系统通知。
 * 【原理】appendLogCore 恒定 push 到 chatLog（内存 = hydration 缓存）；world AddChatLogEntry/AfterAddChatLogEntry 改由 messageCommit / broadcastAndPersist 唯一触发。
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

import { getActiveGroupRuntime } from './persistence.mjs'
import { groupMetadatas } from './wsLifecycle.mjs'

/**
 * 追加一条日志到元数据并持久化侧车。
 * @param {string} groupId 群 ID
 * @param {object} chatMetadata 会话元数据
 * @param {object} entry 日志条目
 * @returns {Promise<void>}
 */
async function appendLogCore(groupId, chatMetadata, entry) {
	chatMetadata.chatLog.push(entry)

	const sidecarChannel = await resolveGroupChannelId(chatMetadata.username, groupId, entry.extension?.groupChannelId)
	await persistLogContextSidecar(chatMetadata.username, groupId, sidecarChannel, entry)

	chatMetadata.timeLines = [entry]
	chatMetadata.timeLineIndex = 0
	chatMetadata.LastTimeSlice = entry.extension.timeSlice
}

/**
 * 追加聊天日志并同步 DAG（world 钩子在 commit / persist 层触发）。
 * @param {string} groupId 群 ID
 * @param {object} entry 日志条目
 * @returns {Promise<object>} 写入后的条目
 */
export async function addChatLogEntry(groupId, entry) {
	const chatMetadata = await getActiveGroupRuntime(groupId)
	await appendLogCore(groupId, chatMetadata, entry)

	if (entry.role === 'char' && entry.extension.timeSlice.charname) {
		const spokenChars = new Set(chatMetadata.chatLog.filter(e => e.role === 'char' && e.extension.timeSlice.charname).map(e => e.extension.timeSlice.charname))
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

	return entry
}
