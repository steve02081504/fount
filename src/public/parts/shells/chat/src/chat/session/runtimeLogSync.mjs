/**
 * 【文件】`session/runtimeLogSync.mjs` — 已提交频道消息到内存 runtime 的增量同步。
 * 【职责】把刚落盘的一条 message / message_edit / message_delete 反映进**已加载**的 chatMetadata，不做整表重水合。
 * 【原理】仅重新投影该 eventId 的单行（复用 hydration 的解密/编辑折叠/说话人解析），再按 eventId 就地替换、追加或删除；
 *   并保持 LastTimeSlice、timeLines 与 chatLog 末条一致，避免触发回复时读到旧正文或密文占位。
 * 【数据结构】chatMetadata.chatLog / timeLines / timeLineIndex / LastTimeSlice；行来源为 `readChannelMessagesForUser`。
 * 【关联】dag/eventPersist（唯一调用点）、dag/hydration、group/queries、session/messages。
 */
import { readChannelMessagesForUser } from '../../group/queries.mjs'
import { buildChatLogEntriesFromChannelLines, loadDagHydrationI18n } from '../dag/hydration.mjs'
import { getState } from '../dag/materialize.mjs'

import { groupMetadatas } from './wsLifecycle.mjs'

/** 会进内存 chatLog 的频道事件类型。 */
const RUNTIME_LOG_EVENT_TYPES = ['message', 'message_edit', 'message_delete']

/**
 * 同步一条已落盘频道消息到已加载的 runtime；该群未加载时是空操作。
 * 编辑/删除按 `content.targetId` 反查目标消息，与投影结果一致（不缓存密文或占位正文）。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} line 已落盘频道行
 * @returns {Promise<void>} 同步完成
 */
export async function syncCommittedRuntimeMessage(username, groupId, channelId, line) {
	const slot = groupMetadatas.get(groupId)
	const metadata = slot?.username === username ? slot.chatMetadata : null
	if (!metadata || !RUNTIME_LOG_EVENT_TYPES.includes(line.type)) return
	const eventId = line.type === 'message' ? line.eventId : line.content?.targetId
	if (!eventId) return

	const rows = await readChannelMessagesForUser(username, groupId, channelId, { eventIds: [eventId] })
	const i18n = await loadDagHydrationI18n(username)
	const { state } = await getState(username, groupId)
	const entries = await buildChatLogEntriesFromChannelLines(
		rows.filter(row => !row.content?.is_generating),
		metadata.LastTimeSlice,
		i18n,
		channelId,
		username,
		groupId,
		state,
	)
	const incoming = entries.find(entry => entry.extension.chat.eventId === eventId)
	const index = metadata.chatLog.findIndex(entry => entry.extension?.chat?.eventId === eventId
		|| entry.id === incoming?.id)
	const existing = metadata.chatLog[index]
	if (incoming && existing) {
		// 保留内存侧独有的 extension（本地 clientMessageId 等），只覆盖投影出的字段。
		const extension = { ...existing.extension, chat: { ...existing.extension?.chat, ...incoming.extension.chat } }
		delete existing.content_for_show
		delete existing.content_for_edit
		Object.assign(existing, incoming, { extension })
	}
	else if (incoming) metadata.chatLog.push(incoming)
	else if (existing) metadata.chatLog.splice(index, 1)

	metadata.chatLog.sort((left, right) => Date.parse(left.time_stamp) - Date.parse(right.time_stamp))
	const last = metadata.chatLog.at(-1)
	metadata.timeLines = last ? [last] : []
	metadata.timeLineIndex = 0
	if (last) metadata.LastTimeSlice = last.extension.timeSlice
}
