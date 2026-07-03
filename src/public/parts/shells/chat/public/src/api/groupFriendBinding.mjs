/**
 * 【文件】public/src/api/groupFriendBinding.mjs
 * 【职责】群元数据上的好友私聊绑定：写入/清除 friendBinding（group_meta_update）。
 * 【原理】normalizeFriendBinding 后 POST；unbind 变体清除 char 或 user 绑定。
 * 【数据结构】FriendBinding { entityHash, displayName?, charname? }。
 * 【关联】friendBinding.mjs、groupClient.mjs；Hub 好友频道。
 */
import { normalizeFriendBinding } from '../../shared/friendBinding.mjs'

import { groupFetch, groupPath } from './groupClient.mjs'

/**
 * 写入或清除群上的好友私聊绑定元数据（`group_meta_update`）。
 * @param {string} groupId 群 ID
 * @param {import('../../shared/friendBinding.mjs').FriendBinding | null} friendBinding 绑定；`null` 表示解绑
 * @returns {Promise<void>}
 */
export async function setGroupFriendBinding(groupId, friendBinding) {
	const normalized = friendBinding === null ? null : normalizeFriendBinding(friendBinding)
	if (friendBinding !== null && !normalized) throw new Error('invalid friendBinding')
	await groupFetch(groupPath(groupId, 'meta'), {
		method: 'PUT',
		json: { friendBinding: normalized },
	})
}

/**
 * 解除好友私聊绑定：群回到侧栏；有角色绑定时一并 session unbind。
 * @param {string} groupId 群 ID
 * @param {{ charname?: string | null }} [opts] 选项
 * @returns {Promise<void>}
 */
export async function unbindFriendGroup(groupId, { charname } = {}) {
	const name = charname?.trim()
	if (name)
		await groupFetch(groupPath(groupId, 'char', name), { method: 'DELETE' })
	await setGroupFriendBinding(groupId, null)
}

/**
 * 解除角色好友绑定：会话 unbind + 清除元数据（群保留并回到左侧群列表）。
 * @param {string} groupId 群 ID
 * @param {string} charname 角色名
 * @returns {Promise<void>}
 */
export async function unbindCharFriendChat(groupId, charname) {
	await unbindFriendGroup(groupId, { charname })
}
