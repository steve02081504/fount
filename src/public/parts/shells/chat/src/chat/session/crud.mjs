/**
 * 【文件】crud.mjs — 群会话生命周期 CRUD 与导入导出
 * 【职责】newGroup/deleteGroup、import/export/copy 会话、listGroupSessions、getInitialData；监听用户删除/重命名清理或修正 groupMetadatas。
 * 【原理】newMetadata 写默认 persona/world/plugin DAG 事件后 rebuild；deleteGroup 调 removeLocalGroupReplica；import 走 addChatLogEntryImport；export/importGroupChat 经 JSON 快照；list 合并内存注册与 listUserGroups。
 * 【数据结构】导出 JSON（chars/world/persona/plugins/frequency/messages）；getInitialData 返回 charlist、initialLog 等 Hub 快照。
 * 【关联】wsLifecycle（deleteGroup 钩子、purge）、partConfig、dag/lifecycle、events AfterUserDeleted/Renamed。
 */
/** @typedef {import('../../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../../../decl/userAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../../../decl/pluginAPI.ts').PluginAPI_t} PluginAPI_t */
/** @typedef {import('../../../../../../../decl/basedefs.ts').locale_t} locale_t */

import { geti18nForUser } from '../../../../../../../scripts/i18n.mjs'
import { events } from '../../../../../../../server/events.mjs'
import { skip_report } from '../../../../../../../server/server.mjs'
import { createGroup, removeLocalGroupReplica } from '../dag/lifecycle.mjs'
import { getLocalSignerForNewGroup } from '../dag/localSigner.mjs'
import { rebuildAndSaveCheckpoint } from '../dag/materialize.mjs'
import { getDefaultChannelId } from '../dag/queries.mjs'
import { listUserGroups } from '../lib/userGroups.mjs'

import { addChatLogEntryImport } from './chatLogAppend.mjs'
import {
	appendSessionPersonaSet,
	appendSessionPluginAdd,
	appendSessionWorldBind,
	getMaterializedSession,
} from './dagSession.mjs'
import { buildChatLogEntryFromCharReply, buildChatLogEntryFromUserMessage } from './logEntries.mjs'
import { chatMetadata_t } from './models.mjs'
import { addchar, addplugin, setCharSpeakingFrequency, setPersona, setWorld } from './partConfig.mjs'
import { getActiveGroupRuntime, getSummaryFromMetadata } from './persistence.mjs'
import { registerGroupRuntime, rebuildGroupRuntime } from './runtime.mjs'
import { groupMetadatas, purgeGroupSession } from './wsLifecycle.mjs'

/**
 * 为指定的聊天ID创建一个新的、空的元数据实例。
 * @param {string} groupId 聊天 ID
 * @param {string} username 聊天的所有者用户名
 * @returns {Promise<void>}
 */
export async function newMetadata(groupId, username) {
	registerGroupRuntime(groupId, username)
	const defaults = await chatMetadata_t.StartNewAs(username)
	const batchOpts = { skipCheckpointRebuild: true, skipReleaseQuarantined: true, publishFederation: false }
	if (defaults.LastTimeSlice.player_id)
		await appendSessionPersonaSet(username, groupId, defaults.LastTimeSlice.player_id, batchOpts)
	if (defaults.LastTimeSlice.world_id)
		await appendSessionWorldBind(username, groupId, defaults.LastTimeSlice.world_id, batchOpts)
	for (const pluginname of Object.keys(defaults.LastTimeSlice.plugins))
		await appendSessionPluginAdd(username, groupId, pluginname, batchOpts)
	await rebuildAndSaveCheckpoint(username, groupId, { skipChannelGc: true })
	await rebuildGroupRuntime(groupId, username)
}

/**
 * 生成不与内存冲突的随机聊天 ID。
 * @returns {string} 可用 groupId
 */
export function findEmptyGroupId() {
	while (true) {
		const uuid = Math.random().toString(36).substring(2, 15)
		if (!groupMetadatas.has(uuid)) return uuid
	}
}

/**
 * 创建一个全新的聊天（每个聊天天然对应一个群，groupId 即 groupId）。
 * @param {string} username - 新聊天的所有者用户名。
 * @param {{ name?: string, defaultChannelName?: string }} [options] 可选：群显示名与默认频道名
 * @returns {Promise<string>} 新创建的聊天的ID。
 */
export async function newGroup(username, options = {}) {
	const groupId = findEmptyGroupId()
	const { sender: ownerPubKeyHash, secretKey } = await getLocalSignerForNewGroup(username, groupId)
	const result = await createGroup(username, {
		groupId,
		ownerPubKeyHash,
		secretKey,
		name: options.name || await geti18nForUser(username, 'chat.group.defaults.dmChatName'),
		defaultChannelName: options.defaultChannelName,
	})
	registerGroupRuntime(result.groupId, username)
	await newMetadata(result.groupId, username)
	return result.groupId
}

/**
 * 删除一个或多个本地会话目录与 DAG 数据。
 * @param {string[]} groupIds 会话 ID 列表
 * @param {string} username 用户名
 * @returns {Promise<Array<{ groupId: string, error?: string }>>} 各群删除结果
 */
export async function deleteGroup(groupIds, username) {
	const deletePromises = groupIds.map(async groupId => {
		try {
			await removeLocalGroupReplica(username, groupId)
			return { groupId }
		}
		catch (error) {
			console.error(`Error deleting group ${groupId}:`, error)
			return { groupId, error: error.message }
		}
	})
	return Promise.all(deletePromises)
}

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
 * 列出用户所有本地角色会话摘要（供历史列表页）。
 * @param {string} username 用户名
 * @returns {Promise<Array<object>>} 会话摘要行
 */
export async function listGroupSessions(username) {
	const groupIds = new Set()
	for (const [groupId, data] of groupMetadatas.entries())
		if (data.username === username)
			groupIds.add(groupId)

	for (const groupId of await listUserGroups(username))
		groupIds.add(groupId)

	const rows = []
	for (const groupId of groupIds)
		try {
			registerGroupRuntime(groupId, username)
			const meta = await getActiveGroupRuntime(groupId)
			if (!meta) continue
			const session = await getMaterializedSession(username, groupId)
			const summary = getSummaryFromMetadata(groupId, meta)
			if (!summary) continue
			rows.push({
				...summary,
				chars: Object.keys(session.chars || {}),
				groupId,
			})
		}
		catch (error) {
			console.warn(`listGroupSessions: skipping group ${groupId}: ${error?.message || error}`)
		}

	rows.sort((a, b) => new Date(b.lastMessageTime || 0) - new Date(a.lastMessageTime || 0))
	return rows
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
	if (data.world) await setWorld(groupId, channelId, data.world)
	for (const pluginname of data.plugins || []) await addplugin(groupId, pluginname)
	for (const charname of data.chars || []) await addchar(groupId, charname, username)
	for (const [charname, frequency] of Object.entries(data.frequency || {}))
		await setCharSpeakingFrequency(groupId, charname, Number(frequency))

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

/**
 * 前端进入聊天页所需的初始快照（角色列表、最近日志等）。
 * @param {string} groupId 聊天 ID
 * @returns {Promise<object>} 初始数据对象
 */
export async function getInitialData(groupId) {
	const entry = groupMetadatas.get(groupId)
	if (!entry?.username) throw skip_report(new Error('Group not found'))
	const { username } = entry
	const chatMetadata = await getActiveGroupRuntime(groupId)
	if (!chatMetadata) throw skip_report(new Error('Group not found'))
	const session = await getMaterializedSession(username, groupId)
	const channelId = await getDefaultChannelId(username, groupId)
	const channelWorld = session.channelWorlds?.[channelId]?.worldname
		|| session.world?.worldname
		|| null
	return {
		charlist: Object.keys(session.chars || {}),
		pluginlist: session.plugins?.[username] || Object.keys(chatMetadata.LastTimeSlice.plugins || {}),
		worldname: channelWorld || chatMetadata.LastTimeSlice.world_id || null,
		personaname: session.personas?.[username] ?? chatMetadata.LastTimeSlice.player_id ?? null,
		frequency_data: { ...session.charFrequencies, ...chatMetadata.LastTimeSlice.chars_speaking_frequency },
		logLength: chatMetadata.chatLog.length,
		initialLog: await Promise.all(chatMetadata.chatLog.slice(-20).map(x => x.toData(username))),
	}
}

events.on('AfterUserDeleted', async payload => {
	const { username } = payload
	const groupIdsToDeleteFromCache = []
	for (const [groupId, data] of groupMetadatas.entries())
		if (data.username === username)
			groupIdsToDeleteFromCache.push(groupId)
	groupIdsToDeleteFromCache.forEach(groupId => purgeGroupSession(groupId))
})

events.on('AfterUserRenamed', async ({ oldUsername, newUsername }) => {
	for (const [groupId, data] of groupMetadatas.entries())
		if (data.username === oldUsername) {
			data.username = newUsername
			if (data.chatMetadata?.username === oldUsername)
				data.chatMetadata.username = newUsername
		}
})
