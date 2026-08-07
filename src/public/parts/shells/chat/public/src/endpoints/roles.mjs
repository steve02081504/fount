/**
 * 【文件】public/src/endpoints/roles.mjs
 * 【职责】群角色 CRUD：创建角色、更新角色权限位、删除角色。
 * 【关联】groupSettings/permissionsTab.mjs；后端 group/roles 路由。
 */
import { groupFetch, groupPath } from './groupClient.mjs'

/**
 * 创建群角色。
 * @param {string} groupId 群 ID
 * @param {string} name 角色名
 * @returns {Promise<object>} 服务端响应
 */
export function createRole(groupId, name) {
	return groupFetch(groupPath(groupId, 'roles'), { method: 'POST', json: { name } })
}

/**
 * 更新角色单条权限位。
 * @param {string} groupId 群 ID
 * @param {string} roleId 角色 ID
 * @param {string} permission 权限键
 * @param {boolean} enabled 是否启用
 * @returns {Promise<void>}
 */
export async function updateRolePermission(groupId, roleId, permission, enabled) {
	await groupFetch(groupPath(groupId, 'roles', roleId, 'permissions'), {
		method: 'PUT',
		json: { permission, enabled },
	})
}

/**
 * 删除群角色。
 * @param {string} groupId 群 ID
 * @param {string} roleId 角色 ID
 * @returns {Promise<void>}
 */
export async function deleteRole(groupId, roleId) {
	await groupFetch(groupPath(groupId, 'roles', roleId), { method: 'DELETE' })
}
