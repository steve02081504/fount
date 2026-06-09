import { resolveTargetMemberKey, withGroupId } from './helpers.mjs'

/** @type {Record<string, (state: object, event: object) => object>} */
export const roleReducers = {
	/**
	 * 处理 `role_create` 事件：在 `roles` 中新建角色定义。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	role_create(state, event) {
		withGroupId(state, event)
		state.roles[event.content.roleId] = {
			name: event.content.name,
			color: event.content.color,
			position: event.content.position || 0,
			permissions: event.content.permissions,
			isDefault: false,
			isHoisted: event.content.isHoisted || false,
		}
		return state
	},

	/**
	 * 处理 `role_update` 事件：合并更新已有角色字段。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	role_update(state, event) {
		withGroupId(state, event)
		if (state.roles[event.content.roleId])
			Object.assign(state.roles[event.content.roleId], event.content.updates)
		return state
	},

	/**
	 * 处理 `role_delete` 事件：删除角色并从所有成员角色列表中移除。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	role_delete(state, event) {
		withGroupId(state, event)
		delete state.roles[event.content.roleId]
		for (const member of Object.values(state.members))
			member.roles = member.roles.filter(role => role !== event.content.roleId)
		return state
	},

	/**
	 * 处理 `role_assign` 事件：为目标成员追加角色 id。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	role_assign(state, event) {
		withGroupId(state, event)
		const target = resolveTargetMemberKey(event.content)
		const roleId = event.content?.roleId
		if (target && state.members[target] && !state.members[target].roles.includes(roleId))
			state.members[target].roles.push(roleId)
		return state
	},

	/**
	 * 处理 `role_revoke` 事件：从目标成员移除指定角色 id。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	role_revoke(state, event) {
		withGroupId(state, event)
		const target = resolveTargetMemberKey(event.content)
		const roleId = event.content?.roleId
		if (target && state.members[target])
			state.members[target].roles = state.members[target].roles.filter(role => role !== roleId)
		return state
	},
}
