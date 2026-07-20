/**
 * 【文件】sessionQueries.mjs — 群会话查询
 * 【职责】getInitialData。
 * 【关联】wsLifecycle、dag/materialize、persistence。
 */
import { skip_report } from '../../../../../../../server/server.mjs'
import { getDefaultChannelId } from '../dag/queries.mjs'

import { getMaterializedSession } from './dagSession.mjs'
import { getLocalPluginNames } from './localPlugins.mjs'
import { getActiveGroupRuntime } from './persistence.mjs'
import { groupMetadatas } from './wsLifecycle.mjs'

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
		pluginlist: await getLocalPluginNames(username, groupId),
		worldname: channelWorld || chatMetadata.LastTimeSlice.world_id || null,
		personaname: session.personas?.[username] ?? chatMetadata.LastTimeSlice.player_id ?? null,
		frequency_data: { ...session.charFrequencies, ...chatMetadata.LastTimeSlice.chars_speaking_frequency },
		logLength: chatMetadata.chatLog.length,
		initialLog: await Promise.all(chatMetadata.chatLog.slice(-20).map(x => x.toData(username))),
	}
}
