/**
 * 【文件】channelWorld.mjs — 频道级世界名查询门面
 * 【职责】根据 groupId 与 channelId 返回当前 replica 在该频道绑定的世界部件名（供路由或 UI 展示）。
 * 【原理】从 groupMetadatas 取 username，委托 partConfig.getSessionWorldName 读取物化 session 的 channelWorlds 或群级 world 绑定。
 * 【数据结构】channelId（默认 default）、session.channelWorlds[channelId].worldname。
 * 【关联】partConfig、wsLifecycle、endpoints 层世界设置 API。
 */
/** @typedef {import('../../../../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */

import { getSessionWorldName } from './partConfig.mjs'
import { groupMetadatas } from './wsLifecycle.mjs'

/**
 * 返回指定频道绑定的世界名。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<string | undefined>} 世界名
 */
export async function getWorldName(groupId, channelId) {
	channelId = channelId ?? 'default'
	const username = groupMetadatas.get(groupId)?.username
	if (!username) return undefined
	return await getSessionWorldName(groupId, channelId, username) || undefined
}
