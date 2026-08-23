import { resolvePermBlockOwner } from '../permBlockOwner.mjs'

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
			links: Array.isArray(event.content.links) ? [...event.content.links] : [],
			permBlockId: event.content.permBlockId || null,
			parentEventId: event.content.parentEventId || null,
			syncScope: event.content.syncScope || 'group',
			isPrivate: event.content.isPrivate || false,
			subRoomId: event.content.subRoomId || null,
			createdAt: event.timestamp,
		}
		// 携带父频道 id 时，将新频道追加到父频道的子链接末尾（单向父→子）。
		const parentChannelId = event.content.parentChannelId || null
		if (parentChannelId && state.channels[parentChannelId]) {
			const parentLinks = state.channels[parentChannelId].links || []
			if (!parentLinks.includes(event.content.channelId))
				state.channels[parentChannelId].links = [...parentLinks, event.content.channelId]
		}
		return state
	},

	/**
	 * 处理 `channel_update` 事件：合并更新已有频道字段。
	 * 脱钩（`updates.permBlockId === null`）时把当前有效权限块复制进本频道自有覆写。
	 * @param {object} state 物化群状态
	 * @param {object} event DAG 事件
	 * @returns {object} 更新后的 state
	 */
	channel_update(state, event) {
		withGroupId(state, event)
		const { channelId, updates } = event.content
		const channel = state.channels[channelId]
		if (!channel) return state
		if (updates.permBlockId === null && channel.permBlockId) {
			const owner = resolvePermBlockOwner(state, channelId)
			const block = state.channelPermissions?.[owner]
			if (block) state.channelPermissions[channelId] = structuredClone(block)
		}
		Object.assign(channel, updates)
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
		const toDelete = new Set([channelId])
		const stack = [channelId]
		while (stack.length) {
			const id = stack.pop()
			const channel = state.channels[id]
			if (!channel) continue
			for (const childId of channel.links || [])
				if (!toDelete.has(childId)) {
					toDelete.add(childId)
					stack.push(childId)
				}
		}
		// 先给引用被删权限块的频道复制其有效块：在 channelPermissions 删除前保留既有覆写。
		for (const channel of Object.values(state.channels))
			if (channel && channel.permBlockId && toDelete.has(channel.permBlockId)) {
				const owner = resolvePermBlockOwner(state, channel.permBlockId)
				const block = state.channelPermissions?.[owner]
				if (block) state.channelPermissions[channel.id] = structuredClone(block)
			}
		for (const id of toDelete) {
			delete state.channels[id]
			delete state.channelPermissions[id]
		}
		for (const channel of Object.values(state.channels))
			if (channel && Array.isArray(channel.links))
				channel.links = channel.links.filter(id => !toDelete.has(id))
		for (const channel of Object.values(state.channels))
			if (channel && channel.permBlockId && toDelete.has(channel.permBlockId))
				channel.permBlockId = null
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
