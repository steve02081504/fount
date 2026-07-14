/**
 * 【文件】sessionQueries.mjs — 群会话查询
 * 【职责】listGroupSessions、getInitialData。
 * 【关联】wsLifecycle、dag/materialize、persistence。
 */
import { skip_report } from '../../../../../../../server/server.mjs'
import { getState } from '../dag/materialize.mjs'
import { getDefaultChannelId } from '../dag/queries.mjs'
import { listUserGroups } from '../lib/userGroups.mjs'

import { getMaterializedSession } from './dagSession.mjs'
import { getActiveGroupRuntime, getSummaryFromMetadata } from './persistence.mjs'
import { registerGroupRuntime } from './runtime.mjs'
import { groupMetadatas } from './wsLifecycle.mjs'

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
			const { state } = await getState(username, groupId)
			const session = state.session || { chars: {}, world: null, channelWorlds: {}, personas: {}, plugins: {}, charFrequencies: {} }
			const summary = getSummaryFromMetadata(groupId, meta)
			if (!summary) continue
			rows.push({
				...summary,
				chars: Object.keys(session.chars || {}),
				groupId,
				groupName: state.groupMeta?.name || '',
			})
		}
		catch (error) {
			console.warn(`listGroupSessions: skipping group ${groupId}: ${error?.message || error}`)
		}

	rows.sort((a, b) => new Date(b.lastMessageTime || 0) - new Date(a.lastMessageTime || 0))
	return rows
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
