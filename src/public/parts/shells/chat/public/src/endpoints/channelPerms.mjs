/**
 * 【文件】public/src/endpoints/channelPerms.mjs
 * 【职责】频道级角色权限覆盖：查询与更新。
 * 【关联】groupSettings/channelPermsTab.mjs；后端 group/channels/:id/permissions 路由。
 */
import { groupFetch, groupPath } from './groupClient.mjs'

/**
 * 拉取频道各角色的权限覆盖。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<Record<string, { allow?: Record<string, boolean>, deny?: Record<string, boolean> }>>} 各角色频道权限
 */
export async function getChannelPermissions(groupId, channelId) {
	const data = await groupFetch(groupPath(groupId, 'channels', channelId, 'permissions'), { method: 'GET' })
	return data.permissions || {}
}

/**
 * 更新单个角色在该频道的权限覆盖。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} roleId 角色 ID
 * @param {Record<string, boolean>} allow 允许位图
 * @param {Record<string, boolean>} deny 拒绝位图
 * @returns {Promise<void>}
 */
export async function putChannelPermissions(groupId, channelId, roleId, allow, deny) {
	await groupFetch(groupPath(groupId, 'channels', channelId, 'permissions'), {
		method: 'PUT',
		json: { roleId, allow, deny },
	})
}
