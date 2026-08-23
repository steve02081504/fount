/**
 * 【文件】public/src/endpoints/groupCategory.mjs
 * 【职责】频道分类的 CRUD 与分类级角色权限覆盖。
 * 【关联】后端 group/routes/governance.mjs 的 /categories 路由；hub 侧栏与 settings。
 */
import { groupFetch, groupPath } from './groupClient.mjs'

/**
 * 拉取群内全部分类与分类权限。
 * @param {string} groupId 群 ID
 * @returns {Promise<{ categories: Record<string, object>, categoryPermissions: Record<string, Record<string, { allow?: object, deny?: object }>> }>} 全部分类与分类权限
 */
export async function getGroupCategories(groupId) {
	const data = await groupFetch(groupPath(groupId, 'categories'), { method: 'GET' })
	return { categories: data.categories || {}, categoryPermissions: data.categoryPermissions || {} }
}

/**
 * 新建频道分类。
 * @param {string} groupId 群 ID
 * @param {string} name 分类名
 * @param {number} [position] 排序位
 * @returns {Promise<string>} 新分类 ID
 */
export async function createCategory(groupId, name, position = 0) {
	const data = await groupFetch(groupPath(groupId, 'categories'), {
		method: 'POST',
		json: { name, position },
	})
	return data.categoryId
}

/**
 * 更新频道分类元数据。
 * @param {string} groupId 群 ID
 * @param {string} categoryId 分类 ID
 * @param {{ name?: string, position?: number }} updates 变更字段
 * @returns {Promise<void>} 无
 */
export async function updateCategory(groupId, categoryId, updates) {
	await groupFetch(groupPath(groupId, 'categories', categoryId), {
		method: 'PUT',
		json: updates,
	})
}

/**
 * 删除频道分类（其下频道解除归属）。
 * @param {string} groupId 群 ID
 * @param {string} categoryId 分类 ID
 * @returns {Promise<void>} 无
 */
export async function deleteCategory(groupId, categoryId) {
	await groupFetch(groupPath(groupId, 'categories', categoryId), {
		method: 'DELETE',
	})
}

/**
 * 拉取分类各角色的权限覆盖。
 * @param {string} groupId 群 ID
 * @param {string} categoryId 分类 ID
 * @returns {Promise<Record<string, { allow?: Record<string, boolean>, deny?: Record<string, boolean> }>>} 各角色分类权限
 */
export async function getCategoryPermissions(groupId, categoryId) {
	const data = await groupFetch(groupPath(groupId, 'categories', categoryId, 'permissions'), { method: 'GET' })
	return data.permissions || {}
}

/**
 * 更新单个角色在该分类的权限覆盖。
 * @param {string} groupId 群 ID
 * @param {string} categoryId 分类 ID
 * @param {string} roleId 角色 ID
 * @param {Record<string, boolean>} allow 允许位图
 * @param {Record<string, boolean>} deny 拒绝位图
 * @returns {Promise<void>} 无
 */
export async function putCategoryPermissions(groupId, categoryId, roleId, allow, deny) {
	await groupFetch(groupPath(groupId, 'categories', categoryId, 'permissions'), {
		method: 'PUT',
		json: { roleId, allow, deny },
	})
}
