/**
 * 【文件】importExport.mjs — 群会话导入导出
 * 【职责】export/import/copyGroupChat、importMessages。
 * 【关联】groupLifecycle.newGroup、partConfig、chatLogAppend。
 */
import { getDefaultChannelId } from '../dag/queries.mjs'

import { addChatLogEntryImport } from './chatLogAppend.mjs'
import { newGroup } from './groupLifecycle.mjs'
import { buildChatLogEntryFromCharReply, buildChatLogEntryFromUserMessage } from './logEntries.mjs'
import { addchar, addplugin, setCharReplyFrequency, setPersona, bindWorld } from './partConfig.mjs'
import { getActiveGroupRuntime } from './persistence.mjs'
import { groupMetadatas } from './wsLifecycle.mjs'

/**
 * 批量导入消息（不触发角色回复）。
 * @param {string} groupId 聊天 ID
 * @param {string} channelId 频道 ID
 * @param {Array<object>} messages 消息数组
 * @param {string} username 用户名
 * @returns {Promise<void>}
 */
export async function importMessages(groupId, channelId, messages, username) {
	const chatMetadata = await getActiveGroupRuntime(groupId)
	if (!chatMetadata) throw new Error('Group not found')

	for (const importedMessage of messages) {
		const timeSlice = chatMetadata.LastTimeSlice.copy()
		/** @type {chatLogEntry_t} */
		let entry
		if (importedMessage.role === 'char') {
			const charname = importedMessage.charname || Object.keys(timeSlice.chars)[0]
			const char = timeSlice.chars[charname]
			entry = await buildChatLogEntryFromCharReply(
				{
					content: importedMessage.content ?? '',
					content_for_show: importedMessage.content_for_show,
					files: importedMessage.files || [],
					extension: importedMessage.extension || {},
				},
				timeSlice,
				char,
				charname,
				username,
			)
		}
		else
			entry = await buildChatLogEntryFromUserMessage(
				{
					content: importedMessage.content ?? '',
					files: importedMessage.files || [],
					extension: { ...importedMessage.extension || {}, groupChannelId: channelId },
					groupChannelId: channelId,
				},
				timeSlice,
				timeSlice.player,
				timeSlice.player_id,
				username,
			)

		if (importedMessage.time_stamp)
			entry.time_stamp = new Date(importedMessage.time_stamp)
		await addChatLogEntryImport(groupId, entry)
	}
}

/**
 * 导出会话为 JSON。
 * @param {string} groupId 聊天 ID
 * @returns {Promise<object>} 导出对象
 */
export async function exportGroupChat(groupId) {
	const chatMetadata = await getActiveGroupRuntime(groupId)
	if (!chatMetadata) throw new Error('Group not found')
	const username = groupMetadatas.get(groupId)?.username
	const timeSlice = chatMetadata.LastTimeSlice
	const serialized = await Promise.all(chatMetadata.chatLog.map(e => e.toData(username)))
	return {
		exportedAt: new Date().toISOString(),
		chars: Object.keys(timeSlice.chars),
		world: timeSlice.world_id || null,
		persona: timeSlice.player_id || null,
		plugins: Object.keys(timeSlice.plugins),
		frequency: { ...timeSlice.chars_speaking_frequency },
		messages: serialized.map(m => ({
			role: m.role,
			name: m.name,
			charname: m.role === 'char' ? m.extension?.charname || m.name : undefined,
			content: m.content,
			content_for_show: m.content_for_show,
			files: m.files,
			time_stamp: m.time_stamp,
			extension: m.extension,
		})),
	}
}

/**
 * 从导出 JSON 导入为新会话。
 * @param {object} data 导出数据
 * @param {string} username 用户名
 * @returns {Promise<{ groupId: string }>} 新会话 ID
 */
export async function importGroupChat(data, username) {
	if (!data?.messages?.length)
		throw new Error('Unsupported export format')

	const groupId = await newGroup(username)
	const channelId = await getDefaultChannelId(username, groupId)

	if (data.persona) await setPersona(groupId, data.persona)
	if (data.world) await bindWorld(groupId, channelId, data.world)
	for (const pluginname of data.plugins || []) await addplugin(groupId, pluginname)
	for (const charname of data.chars || []) await addchar(groupId, charname, username)
	for (const [charname, frequency] of Object.entries(data.frequency || {}))
		await setCharReplyFrequency(groupId, charname, Number(frequency))

	await importMessages(groupId, channelId, data.messages || [], username)
	return { groupId }
}

/**
 * 复制会话（导出后导入为新群）。
 * @param {string} groupId 源聊天 ID
 * @param {string} username 用户名
 * @returns {Promise<{ groupId: string, newGroupId: string }>} 源与新群组 ID
 */
export async function copyGroupChat(groupId, username) {
	const data = await exportGroupChat(groupId)
	const { groupId: newGroupId } = await importGroupChat(data, username)
	return { groupId, newGroupId }
}
