/**
 * 【文件】public/src/endpoints/groupCategory.mjs
 * 【职责】分类频道（`type: 'category'` 的频道）的创建/重命名/删除，及频道权限块读写与一键同步。
 * 【关联】后端 group/routes/channels 与 governance.mjs 的 /channels/:id/permissions 路由；hub 侧栏与 settings。
 */
import { createChannel, deleteChannel, updateChannel } from './groupChannel.mjs'
import { groupFetch, groupPath } from './groupClient.mjs'

/**
 * 新建分类频道（`type: 'category'`，继承群根频道权限块）。
 * @param {string} groupId 群 ID
 * @param {string} name 分类名
 * @returns {Promise<string>} 新分类频道 ID
 */
export async function createCategory(groupId, name) {
	return createChannel(groupId, name, 'category')
}

/**
 * 重命名分类频道。
 * @param {string} groupId 群 ID
 * @param {string} categoryId 分类频道 ID
 * @param {{ name?: string }} updates 变更字段
 * @returns {Promise<void>} 无
 */
export async function updateCategory(groupId, categoryId, updates) {
	await updateChannel(groupId, categoryId, updates)
}

/**
 * 删除分类频道（沿 `links` 删除其子树）。
 * @param {string} groupId 群 ID
 * @param {string} categoryId 分类频道 ID
 * @returns {Promise<void>} 无
 */
export async function deleteCategory(groupId, categoryId) {
	await deleteChannel(groupId, categoryId)
}

/**
 * 读取某频道有效权限块（跟随 `permBlockId` 链到源频道）。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<{ permissions: Record<string, { allow?: Record<string, boolean>, deny?: Record<string, boolean> }>, permBlockId: string | null }>} 各角色权限覆写与块来源
 */
export async function getCategoryPermissions(groupId, channelId) {
	const data = await groupFetch(groupPath(groupId, 'channels', channelId, 'permissions'), { method: 'GET' })
	return { permissions: data.permissions || {}, permBlockId: data.permBlockId || null }
}

/**
 * 更新某频道的单个角色权限覆写（已同步频道会先脱钩复制）。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} roleId 角色 ID
 * @param {Record<string, boolean>} allow 允许位图
 * @param {Record<string, boolean>} deny 拒绝位图
 * @returns {Promise<void>} 无
 */
export async function putCategoryPermissions(groupId, channelId, roleId, allow, deny) {
	await groupFetch(groupPath(groupId, 'channels', channelId, 'permissions'), {
		method: 'PUT',
		json: { roleId, allow, deny },
	})
}

/**
 * 一键同步：子频道权限块强引用父频道块（`permBlockId` 缺省为群根频道）。
 * @param {string} groupId 群 ID
 * @param {string} channelId 目标频道 ID
 * @param {string | null} [permBlockId] 跟随的源频道 id；null 表示同步到根频道
 * @returns {Promise<string | null>} 生效的 permBlockId
 */
export async function syncCategoryPermissions(groupId, channelId, permBlockId = null) {
	const data = await groupFetch(groupPath(groupId, 'channels', channelId, 'permissions', 'sync'), {
		method: 'PUT',
		json: { permBlockId },
	})
	return data.permBlockId ?? null
}
