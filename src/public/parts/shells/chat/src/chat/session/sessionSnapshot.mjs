/**
 * 【文件】sessionSnapshot.mjs — 写入 DAG 消息的 session 快照导出
 * 【职责】exportSessionSnapshot 从物化 session 提取 chars/world/personas/plugins/charFrequencies 精简对象，供 message 事件附带，以便 hydration 还原该条消息当时的 timeSlice。
 * 【原理】频道世界优先：有 channelId 且 channelWorlds[channelId] 存在时用频道绑定，否则用群级 world；与 runtime.buildTimeSliceFromSessionSnapshot 形状对齐。
 * 【数据结构】{ chars, world, personas, plugins, charFrequencies } 纯 JSON 可序列化绑定表。
 * 【关联】dagSession、runtime、dag/chatLogMirror、hydration。
 */
import { getMaterializedSession } from './dagSession.mjs'

/**
 * 写入 DAG message 的 session 快照（供 hydration 还原 timeSlice）。
 * @param {string} replicaUsername replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} [channelId] 当前频道（频道世界覆盖）
 * @returns {Promise<object>} 可写入 DAG message 的 session 快照对象
 */
export async function exportSessionSnapshot(replicaUsername, groupId, channelId) {
	const session = await getMaterializedSession(replicaUsername, groupId)
	const channelWorld = channelId && session.channelWorlds?.[channelId]
		? session.channelWorlds[channelId]
		: null
	return {
		chars: session.chars || {},
		world: channelWorld || session.world || null,
		personas: session.personas || {},
		plugins: session.plugins || {},
		charFrequencies: session.charFrequencies || {},
	}
}
