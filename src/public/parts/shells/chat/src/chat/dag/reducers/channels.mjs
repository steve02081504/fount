import { withGroupId } from './state.mjs'

/** @type {Record<string, (state: object, event: object) => object>} */
export const channelReducers = {
	/**
	 * 处理 `channel_create` 事件：在 `channels` 中新建频道条目。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	channel_create(state, event) {
		withGroupId(state, event)
		state.channels[event.content.channelId] = {
			id: event.content.channelId,
			type: event.content.type,
			name: event.content.name,
			description: event.content.description ?? '',
			parentChannelId: event.content.parentChannelId || null,
			parentEventId: event.content.parentEventId || null,
			syncScope: event.content.syncScope || 'group',
			isPrivate: event.content.isPrivate || false,
			subRoomId: event.content.subRoomId || null,
			createdAt: event.timestamp,
		}
		return state
	},

	/**
	 * 处理 `channel_update` 事件：合并更新已有频道字段。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	channel_update(state, event) {
		withGroupId(state, event)
		if (state.channels[event.content.channelId])
			Object.assign(state.channels[event.content.channelId], event.content.updates)
		return state
	},

	/**
	 * 处理 `channel_delete` 事件：删除频道及其直接子频道。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	channel_delete(state, event) {
		withGroupId(state, event)
		const { channelId } = event.content
		delete state.channels[channelId]
		for (const [id, channel] of Object.entries(state.channels))
			if (channel.parentChannelId === channelId)
				delete state.channels[id]
		return state
	},

	/**
	 * 处理 `list_item_update` 事件：更新频道的手动列表项。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	list_item_update(state, event) {
		withGroupId(state, event)
		if (state.channels[event.channelId])
			state.channels[event.channelId].manualItems = event.content.items
		return state
	},

	/**
	 * 处理 `channel_permissions_update` 事件：写入频道内角色的 allow/deny 覆写。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	channel_permissions_update(state, event) {
		withGroupId(state, event)
		const { channelId } = event.content
		if (!state.channelPermissions[channelId])
			state.channelPermissions[channelId] = {}
		state.channelPermissions[channelId][event.content.roleId] = {
			allow: event.content.allow,
			deny: event.content.deny,
		}
		return state
	},
}
