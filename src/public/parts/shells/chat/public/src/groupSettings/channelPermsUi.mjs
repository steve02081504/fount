/**
 * 【文件】groupSettings/channelPermsUi.mjs
 * 【职责】频道 / 分类权限面板共用的角色权限行渲染原语：角色排序、颜色白名单、三态判定、
 *   权限行 HTML 渲染与懒填。供 channelPermsTab.mjs 与 categoryPermsDialog.mjs 复用。
 */
import { renderTemplateAsHtmlString } from '../templates.mjs'

const ROLE_COLOR_RE = /^#[\da-f]{3}([\da-f]{3})?$/i

/**
 * 将角色颜色规范为白名单内的 hex，否则返回默认灰。
 * @param {string | undefined} color CSS 颜色
 * @returns {string} 白名单内 hex 或默认灰
 */
export function safeRoleColor(color) {
	const value = (color || '').trim()
	return ROLE_COLOR_RE.test(value) ? value : '#888888'
}

/**
 * 根据 allow/deny 位图计算某权限的三态结果。
 * @param {Record<string, boolean> | undefined} allow 允许位图
 * @param {Record<string, boolean> | undefined} deny 拒绝位图
 * @param {string} perm 权限键
 * @returns {'neutral' | 'allow' | 'deny'} 三态结果
 */
export function permTriState(allow, deny, perm) {
	if (deny?.[perm]) return 'deny'
	if (allow?.[perm]) return 'allow'
	return 'neutral'
}

/**
 * 按默认优先、再按 position 对角色表排序并返回角色 id 列表。
 * @param {Record<string, object>} roles 角色表
 * @returns {string[]} 排序后的角色 id（@everyone / isDefault 优先，再按 position）
 */
export function sortedRoleIds(roles) {
	return Object.entries(roles || {})
		.sort(([idA, roleA], [idB, roleB]) => {
			const defaultA = idA === '@everyone' || roleA?.isDefault ? 0 : 1
			const defaultB = idB === '@everyone' || roleB?.isDefault ? 0 : 1
			if (defaultA !== defaultB) return defaultA - defaultB
			return (roleB?.position || 0) - (roleA?.position || 0) || idA.localeCompare(idB)
		})
		.map(([roleId]) => roleId)
}

/**
 * 渲染某角色的权限行 HTML 字符串。
 * @param {string} roleId 角色 id
 * @param {Record<string, boolean> | undefined} allow 允许位图
 * @param {Record<string, boolean> | undefined} deny 拒绝位图
 * @param {string[]} grantablePerms 授予者可配置位
 * @returns {Promise<string>} 权限行 HTML
 */
export async function permRowsHtml(roleId, allow, deny, grantablePerms) {
	return (await Promise.all(grantablePerms.map(perm =>
		renderTemplateAsHtmlString('group/settings/channel_perm_row', {
			perm,
			roleId,
			state: permTriState(allow, deny, perm),
		})
	))).join('')
}

/**
 * 懒填已打开（或刚打开）的角色权限行。
 * @param {HTMLElement} permsEl `.settings-role-perms`
 * @param {string} roleId 角色 id
 * @param {Record<string, { allow?: object, deny?: object }>} permissions 频道/分类覆写表
 * @param {string[]} grantablePerms 授予者可配置位
 * @returns {Promise<void>}
 */
export async function fillRolePermsIfEmpty(permsEl, roleId, permissions, grantablePerms) {
	if (permsEl.childElementCount) return
	const override = permissions[roleId]
	permsEl.innerHTML = await permRowsHtml(roleId, override?.allow, override?.deny, grantablePerms)
}
