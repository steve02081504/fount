import { fetchGroupStateData } from '../groupApplyHashState.mjs'
import { handleUIError } from '../utils.mjs'

import { updateGroupAvPanelVisibility } from './avPanelToggle.mjs'
import { renderGroupChannelTree } from './channelTreeRender.mjs'
import { MEMBER_LIST_DEFER_FIRST_PAINT_MIN, renderGroupMemberList } from './memberListRender.mjs'

/**
 * 拉取群组状态并刷新频道树、成员列表与音视频面板显隐。
 * @param {{
 *   groupId: string,
 *   channelId: string,
 *   tree: HTMLElement,
 *   members: HTMLElement | null,
 *   stateSlice: {
 *     lastGroupSettings: object,
 *     lastChannels: Record<string, object>,
 *     lastChannelMeta: object | null,
 *   },
 * }} args 群组标识、DOM 容器与可变的 `stateSlice` 引用
 * @returns {Promise<void>}
 */
export async function loadGroupStateDom({
	groupId,
	channelId,
	tree,
	members,
	stateSlice,
}) {
	try {
		const data = await fetchGroupStateData(groupId)
		if (!data) return
		stateSlice.lastGroupSettings = data.groupSettings || {}
		tree.innerHTML = ''
		stateSlice.lastChannels = data.channels || {}
		stateSlice.lastChannelMeta = stateSlice.lastChannels[channelId] || null
		renderGroupChannelTree(tree, { groupId, channelId, lastChannels: stateSlice.lastChannels })
		const mlist = Array.isArray(data.members) ? data.members : []
		if (members && mlist.length >= MEMBER_LIST_DEFER_FIRST_PAINT_MIN)
			requestAnimationFrame(() => renderGroupMemberList(members, mlist))
		else
			renderGroupMemberList(members, mlist)
		updateGroupAvPanelVisibility(channelId, stateSlice.lastChannels)
	}
	catch (e) {
		handleUIError(e, 'chat.group.loadError', 'loadState failed')
	}
}
