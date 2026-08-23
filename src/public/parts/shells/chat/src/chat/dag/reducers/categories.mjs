import { withGroupId } from './state.mjs'

/** @type {Record<string, (state: object, event: object) => object>} */
export const categoryReducers = {
	/**
	 * 处理 `category_create` 事件：在 `categories` 中新建分类。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	category_create(state, event) {
		withGroupId(state, event)
		state.categories[event.content.categoryId] = {
			id: event.content.categoryId,
			name: event.content.name || event.content.categoryId,
			position: Number(event.content.position) || 0,
			createdAt: event.timestamp,
		}
		return state
	},

	/**
	 * 处理 `category_update` 事件：合并更新分类字段。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	category_update(state, event) {
		withGroupId(state, event)
		if (state.categories[event.content.categoryId])
			Object.assign(state.categories[event.content.categoryId], event.content.updates)
		return state
	},

	/**
	 * 处理 `category_delete` 事件：删除分类，并解除其下频道的归属。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	category_delete(state, event) {
		withGroupId(state, event)
		const { categoryId } = event.content
		delete state.categories[categoryId]
		delete state.categoryPermissions[categoryId]
		for (const channel of Object.values(state.channels))
			if (channel && channel.category === categoryId)
				channel.category = null
		return state
	},

	/**
	 * 处理 `category_permissions_update` 事件：写入分类内角色的 allow/deny 覆写。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	category_permissions_update(state, event) {
		withGroupId(state, event)
		const { categoryId } = event.content
		if (!state.categoryPermissions[categoryId])
			state.categoryPermissions[categoryId] = {}
		state.categoryPermissions[categoryId][event.content.roleId] = {
			allow: event.content.allow,
			deny: event.content.deny,
		}
		return state
	},
}
