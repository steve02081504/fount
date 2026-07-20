/**
 * 成员列表展示用角色判定（与物化权限一致，含 founder 等 ADMIN 角色）。
 */

/**
 * @param {{ roles?: string[] }} member 成员行
 * @param {Record<string, { permissions?: Record<string, boolean> }>} [roleDefs] 群 role 定义
 * @returns {boolean} 是否应在 UI 中作为管理员展示
 */
export function memberDisplaysAsAdmin(member, roleDefs = {}) {
	const roles = member?.roles || []
	if (roles.includes('admin') || roles.includes('founder')) return true
	return roles.some(roleId => roleDefs?.[roleId]?.permissions?.ADMIN === true)
}
